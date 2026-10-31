import {
  queueProviderOperation,
  assertProviderOperation,
  observeProviderProcess,
  beginProviderOperation,
  finishProviderOperation,
  cancelQueuedOperation,
  ownsOperation,
  processTarget,
  operationContext,
  type HarnessOperationContext,
  acpTurnWriter,
} from "../turnWriter";

import { killChild } from "../../core/child";
import { PROVIDER_STARTUP_TIMEOUT_MS } from "../../core/providerStartupStatus";
import {
  createProviderRetirementLedger,
  preserveProviderFailure,
  settleProviderRetirements,
} from "../../core/providerRetirement";
import { isApprovalOccurrenceId } from "../../../../shared/model/approvalOccurrence";
import {
  createPendingApproval,
  cancelPendingApprovals,
  observePendingApprovalWrite,
  ownsPendingApproval,
  rejectOverlappingApproval,
  releasePendingApproval,
  type PendingApproval,
  type ApprovalActualWriteObserver,
} from "../pendingApproval";
import {
  nativeOutputSink,
  retainNativeOutputEventOrigin,
  captureNativeOutputWork,
  trackNativeOutputWork,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";
import { JsonRpcResponseError } from "../../core/jsonRpc";
import { AcpClient, type AcpHandlers } from "../../core/acp";
import { reportAcpStopReason } from "../../core/acpStopReason";
import { spawnChild, watchChild, invokeProviderCommand } from "../../core/child";
import { registerHarness, type HarnessAdapter } from "../../core/registry";
import type { ApprovalDecision, HarnessEvent, SendTurnInput } from "../../core/types";
import { promptBlocks } from "../../../../features/sessions/model/attachmentPrompt";
import { setHarnessModels } from "../../../../features/sessions/model/models";
import type { GenericAcpSummary } from "../../../../features/providers/model/genericAcp";
import { textFromContent } from "../../../../shared/lib/contentText";

type GenericPendingApproval = PendingApproval & {
  options: { optionId: string; kind: string }[];
  work: NativeOutputWork | null;
};
import { createChildProcessHandle, type ChildProcessHandle } from "../../core/child";

const operationTailsBySession = new Map<string, Promise<unknown>>();

const retirements = createProviderRetirementLedger("generic-acp.main", killChild);

type Live = {
  operation?: object;
  predecessor?: Promise<void>;
  handle: ChildProcessHandle;
  client: AcpClient;
  providerId: string;
  configId: string;
  cwd: string;
  onEvent: (event: HarnessEvent) => void;
  cancelled: boolean;
  replaying: boolean;
  planning: boolean;
  modes?: { currentModeId: string; availableModes: { id: string }[] };
  previousMode?: string;
  approvals: Map<number, GenericPendingApproval>;
};
const lives = new Map<string, Live>();
const resumes = new Map<string, { providerId: string; cwd: string }>();
const starting = new Map<string, Live>();

function retireWaitingApprovals(live: Live): void {
  cancelPendingApprovals(live.approvals);
}

function servePendingApproval(
  sessionId: string,
  live: Live,
  id: number,
  pending: GenericPendingApproval,
): void {
  const waiter = nativeOutputSink(pending.work, async () => {
    try {
      const decision = await pending.decision;
      if (lives.get(sessionId) !== live) return;
      await nativeOutputSink(pending.work, () => {
        if (lives.get(sessionId) !== live) return Promise.resolve();
        const option =
          ownsPendingApproval(live.approvals, id, pending) && decision !== "cancelled"
            ? pending.options.find(
                (entry) => entry.kind === (decision === "allow" ? "allow_once" : "reject_once"),
              )
            : undefined;
        return live.client.respond(
          id,
          {
            outcome: option
              ? { outcome: "selected", optionId: option.optionId }
              : { outcome: "cancelled" },
          },
          observePendingApprovalWrite(live.approvals, id, pending),
        );
      })();
      pending.report(decision);
    } finally {
      releasePendingApproval(live.approvals, id, pending);
    }
  })();
  void trackNativeOutputWork(waiter, pending.work).catch(() => undefined);
}

async function stop(
  sessionId: string,
  target?: ChildProcessHandle | HarnessOperationContext,
): Promise<void> {
  const context = operationContext(target);
  if (cancelQueuedOperation(context)) return;
  const expectedHandle = processTarget(target);
  const current = lives.get(sessionId);
  const live =
    (!expectedHandle || current?.handle === expectedHandle) &&
    ownsOperation(context, current?.handle, current?.operation)
      ? current
      : undefined;
  const preparing = starting.get(sessionId);
  const startup =
    (!expectedHandle || preparing?.handle === expectedHandle) &&
    ownsOperation(context, preparing?.handle, preparing?.operation)
      ? preparing
      : undefined;
  if (live) lives.delete(sessionId);
  if (startup) starting.delete(sessionId);
  for (const owner of new Set([live, startup])) {
    if (!owner) continue;
    owner.cancelled = true;
    owner.client.close(new Error("ACP process stopped"));
    retireWaitingApprovals(owner);
  }
  const handles = new Set([live?.handle, startup?.handle, ...(!context ? [expectedHandle] : [])]);
  await settleProviderRetirements([
    ...(live?.predecessor ? [live.predecessor] : []),
    ...(startup?.predecessor ? [startup.predecessor] : []),
    context || expectedHandle
      ? retirements.retire(handles)
      : retirements.retireOwner(sessionId, handles),
  ]);
}
async function cancel(sessionId: string, context?: HarnessOperationContext): Promise<void> {
  if (cancelQueuedOperation(context)) return;

  const live = lives.get(sessionId);
  const original = live ?? starting.get(sessionId);
  // A captured cancellation must not affect a newer operation.
  if (!ownsOperation(context, original?.handle, original?.operation)) return;
  if (!live) {
    const startup = starting.get(sessionId);
    if (startup) await stop(sessionId, context ?? startup.handle);
    return;
  }
  const client = context
    ? await acpTurnWriter(live.handle, live.client, context.nativeControlTurn, context, "control")
    : live.client;
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.cancelled = true;
  retireWaitingApprovals(live);
  await client.notify("session/cancel", { sessionId: live.providerId }).catch(() => undefined);
  // A noncompliant agent must not leave the turn waiting forever.
  if (!ownsOperation(context, live.handle, live.operation)) return;
  await stop(sessionId, context ?? live.handle);
}

export async function sendGenericAcpTurn(
  input: SendTurnInput,
  program?: { id: string; path: string; args: string[]; model: string },
): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };

  try {
    const original = lives.get(input.sessionId) ?? starting.get(input.sessionId);
    if (original) observeProviderProcess(input, original.handle);
    return await queueProviderOperation(
      operationTailsBySession,
      input.sessionId,
      input.operationContext,
      async () => {
        const responseScope: { work: NativeOutputWork | null } = { work: null };
        const emitNative = (event: HarnessEvent) =>
          nativeOutputSink(responseScope.work, () => input.onEvent(event))();
        try {
          const configId = program?.id ?? input.model.replace(/^acp:/, "");
          if (!configId) throw new Error("Choose a configured ACP agent in Settings first");
          let live = lives.get(input.sessionId);
          const previous =
            live && (live.configId !== configId || live.cwd !== input.cwd) ? live : undefined;
          if (!live || previous) {
            const originalCohort = retirements.cohort(input.sessionId);
            const handle = retirements.admitPending(
              createChildProcessHandle(input.sessionId, input.nativeControlTurn),
            );
            observeProviderProcess(input, handle, "starting");
            const handlers: AcpHandlers = {};
            const client = new AcpClient(handle, handlers);
            const state: Live = {
              operation: input.operationContext?.operation,
              handle,
              client,
              configId,
              cwd: input.cwd,
              providerId: "",
              onEvent: emitNative,
              cancelled: false,
              replaying: false,
              planning: input.intent === "plan",
              approvals: new Map(),
            };
            starting.set(input.sessionId, state);
            const predecessor = settleProviderRetirements([
              ...(previous ? [stop(input.sessionId, previous.handle)] : []),
              originalCohort.retire(),
            ]);
            state.predecessor = predecessor;
            if (previous) resumes.delete(input.sessionId);
            handlers.onNotification = (method, params) => {
              if (method !== "session/update" || state.cancelled || state.replaying) return;
              const update = (params as { update?: Record<string, unknown> })?.update;
              if (!update) return;
              if (
                update.sessionUpdate === "plan" &&
                typeof update.text === "string" &&
                update.text.trim()
              )
                state.onEvent({ type: "plan", text: update.text });
              if (
                update.sessionUpdate === "agent_message_chunk" &&
                (update.content as { type?: string })?.type === "text"
              )
                state.onEvent({
                  type: "message.delta",
                  text: String((update.content as { text?: string }).text ?? ""),
                });
              if (update.sessionUpdate === "tool_call")
                state.onEvent({
                  type: "tool.started",
                  callId: String(update.toolCallId),
                  title: String(update.title ?? "ACP tool"),
                  kind: String(update.kind ?? "tool"),
                  status: String(update.status ?? "running"),
                });
              if (update.sessionUpdate === "tool_call_update")
                state.onEvent({
                  type: "tool.updated",
                  callId: String(update.toolCallId),
                  status: String(update.status ?? "running"),
                  detail: toolResultDetail(update),
                });
            };
            handlers.onRequest = async (id, method, params) => {
              if (method !== "session/request_permission") {
                await client.respondError(id, {
                  code: -32601,
                  message: "Client capability is not supported",
                });
                return;
              }
              if (state.approvals.has(id)) {
                const duplicateWork = captureNativeOutputWork({ additionalInput: true });
                const overlap = rejectOverlappingApproval(
                  state.approvals,
                  id,
                  nativeOutputSink(duplicateWork, (onActualWrite: ApprovalActualWriteObserver) =>
                    client.respond(id, { outcome: { outcome: "cancelled" } }, onActualWrite),
                  ),
                );
                if (overlap) await trackNativeOutputWork(overlap, duplicateWork);
                return;
              }
              if (state.cancelled || state.replaying) {
                await client.respond(id, { outcome: { outcome: "cancelled" } });
                return;
              }
              const permission = params as {
                options?: { optionId: string; kind: string }[];
                toolCall?: { title?: string; toolCallId?: string; kind?: string };
              };
              if (state.planning) {
                const readOnly =
                  permission.toolCall?.kind === "read" || permission.toolCall?.kind === "search";
                const option = permission.options?.find(
                  (entry) => entry.kind === (readOnly ? "allow_once" : "reject_once"),
                );
                await client.respond(id, {
                  outcome: option
                    ? { outcome: "selected", optionId: option.optionId }
                    : { outcome: "cancelled" },
                });
                return;
              }
              const work = captureNativeOutputWork({ additionalInput: true });
              const pending = Object.assign(
                createPendingApproval((occurrenceId, decision) =>
                  nativeOutputSink(work, () =>
                    state.onEvent({
                      type: "approval.resolved",
                      requestId: id,
                      occurrenceId,
                      decision,
                    }),
                  )(),
                ),
                {
                  options: permission.options ?? [],
                  work,
                },
              );
              const { occurrenceId } = pending;
              state.approvals.set(id, pending);
              servePendingApproval(input.sessionId, state, id, pending);
              state.onEvent({
                type: "approval.requested",
                requestId: id,
                occurrenceId,
                title: permission.toolCall?.title ?? "ACP permission",
                callId: permission.toolCall?.toolCallId,
              });
            };
            watchChild(
              handle,
              (line) => client.pushLine(line),
              (code) => {
                state.cancelled = true;
                retireWaitingApprovals(state);
                client.close(new Error("ACP agent process exited"));
                if (lives.get(input.sessionId) === state) lives.delete(input.sessionId);
                state.onEvent({ type: "session.ended", code });
              },
            );
            try {
              await predecessor;
              if (state.cancelled || starting.get(input.sessionId) !== state)
                throw new Error("ACP startup cancelled");
              if (program)
                await spawnChild(
                  handle,
                  program.path,
                  program.args,
                  input.cwd,
                  undefined,
                  "opencode",
                );
              else await spawnChild(handle, "", [], input.cwd, undefined, undefined, configId);
              if (state.cancelled || starting.get(input.sessionId) !== state)
                throw new Error("ACP startup cancelled");
              const startupAcp = await acpTurnWriter(
                handle,
                client,
                input.nativeControlTurn,
                input.operationContext,
              );
              const initialized = await startupAcp.request<{
                agentCapabilities?: { loadSession?: boolean };
                authMethods?: { id: string; name?: string }[];
              }>(
                "initialize",
                {
                  protocolVersion: 1,
                  clientInfo: { name: "bycoda", version: "1" },
                  clientCapabilities: {
                    fs: { readTextFile: false, writeTextFile: false },
                    terminal: false,
                  },
                },
                PROVIDER_STARTUP_TIMEOUT_MS,
              );
              const configs = await invokeProviderCommand<GenericAcpSummary[]>("generic_acp_list");
              const auth = configs.find((config) => config.id === configId)?.authMethodId;
              if (auth) await startupAcp.request("authenticate", { methodId: auth }, 60_000);
              const resume = resumes.get(input.sessionId);
              if (
                resume &&
                resume.cwd === input.cwd &&
                initialized.agentCapabilities?.loadSession
              ) {
                state.replaying = true;
                try {
                  const loaded = await startupAcp.request<{ modes?: Live["modes"] }>(
                    "session/load",
                    { sessionId: resume.providerId, cwd: input.cwd, mcpServers: [] },
                    30_000,
                  );
                  state.modes = loaded.modes;
                  state.providerId = resume.providerId;
                } catch (error) {
                  if (!(error instanceof JsonRpcResponseError)) throw error;
                } finally {
                  state.replaying = false;
                }
              }
              if (!state.providerId) {
                if (resume) {
                  resumes.delete(input.sessionId);
                  emitNative({ type: "status", text: "The saved provider conversation is unavailable. Starting a new session; the app will restore conversation context." });
                }
                const setup = await startupAcp.request<{
                  sessionId?: string;
                  modes?: Live["modes"];
                }>("session/new", { cwd: input.cwd, mcpServers: [] }, 30_000);
                if (!setup.sessionId) throw new Error("ACP agent returned no session id");
                state.providerId = setup.sessionId;
                state.modes = setup.modes;
              }
              if (state.cancelled || starting.get(input.sessionId) !== state)
                throw new Error("ACP startup cancelled");
              lives.set(input.sessionId, state);
              live = state;
              resumes.set(input.sessionId, { providerId: state.providerId, cwd: input.cwd });
              emitNative({ type: "session.providerBound", providerSessionId: state.providerId });
            } catch (error) {
              state.cancelled = true;
              retireWaitingApprovals(state);
              client.close(error instanceof Error ? error : undefined);
              return preserveProviderFailure(
                error,
                settleProviderRetirements([predecessor, retirements.retire([handle])]),
              );
            } finally {
              if (starting.get(input.sessionId) === state) starting.delete(input.sessionId);
            }
          }
          observeProviderProcess(input, live.handle);
          beginProviderOperation(input.operationContext, live.handle);
          const acp = await acpTurnWriter(
            live.handle,
            live.client,
            input.nativeControlTurn,
            input.operationContext,
          );
          live.onEvent = input.onEvent;
          live.cancelled = false;
          live.planning = input.intent === "plan";
          // A resumed agent can already be in plan mode without a prior client transition.
          if (!live.planning && live.modes?.currentModeId === "plan" && !live.previousMode) {
            live.previousMode = ["default", "build", "code", "ask"].find((id) =>
              live.modes?.availableModes.some((mode) => mode.id === id),
            );
            if (!live.previousMode)
              throw new Error("This ACP agent did not advertise a mode for implementing the plan.");
          }
          if (live.planning && live.modes?.availableModes.some((mode) => mode.id === "plan")) {
            if (live.modes.currentModeId !== "plan") {
              const previousMode = live.modes.currentModeId;
              await acp.request(
                "session/set_mode",
                { sessionId: live.providerId, modeId: "plan" },
                30_000,
              );
              live.previousMode = previousMode;
              live.modes.currentModeId = "plan";
            }
          } else if (!live.planning && live.previousMode && live.modes) {
            await acp.request(
              "session/set_mode",
              { sessionId: live.providerId, modeId: live.previousMode },
              30_000,
            );
            live.modes.currentModeId = live.previousMode;
            live.previousMode = undefined;
          }
          if (program)
            await acp.request(
              "session/set_config_option",
              { sessionId: live.providerId, configId: "model", value: program.model },
              30_000,
            );
          emitNative({ type: "session.started" });
          try {
            const result = await acp.request(
              "session/prompt",
              {
                sessionId: live.providerId,
                prompt: promptBlocks(input.text, input.attachments),
              },
              0,
              (value, work) => {
                responseScope.work?.finish();
                responseScope.work = work ? retainNativeOutputEventOrigin(work.origin) : null;
                return value;
              },
            );
            emitNative({ type: "message.completed" });
            emitNative({ type: "reasoning.completed" });
            if (!live.cancelled) reportAcpStopReason(result, emitNative);
          } catch (error) {
            if (!live.cancelled) throw error;
          }
        } finally {
          responseScope.work?.finish();
        }
      },
    );
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

function toolResultDetail(update: Record<string, unknown>): string | undefined {
  const text = textFromContent(update.content, "\n") || textFromContent(update.rawOutput, "\n");
  return text.trim() ? text.slice(0, 8_000) : undefined;
}

export async function refreshGenericAcpCatalog(): Promise<void> {
  const configs = await invokeProviderCommand<GenericAcpSummary[]>("generic_acp_list");
  setHarnessModels(
    "acp",
    configs.map((config) => ({
      id: `acp:${config.id}`,
      nativeId: config.id,
      harness: "acp",
      name: config.name,
      contextWindow: config.contextWindow,
    })),
  );
}
export const genericAcpAdapter: HarnessAdapter = {
  id: "acp",
  live: true,
  canSteer: false,
  sendTurn: sendGenericAcpTurn,
  steerTurn: async () => {
    throw new Error("Generic ACP does not support steering while a turn is active");
  },
  cancelTurn: cancel,
  stopSession: stop,
  forgetSession: async (id, context) => {
    // Delete/switch must end the process: clear resume state first and stop by
    // session when the context no longer owns it.
    resumes.delete(id);
    const queuedOnly = cancelQueuedOperation(context);
    const original = lives.get(id) ?? starting.get(id);
    const owned =
      !queuedOnly && (!original || ownsOperation(context, original.handle, original.operation));
    await stop(id, owned ? context : undefined);
  },
  bindSession: (id, providerId, cwd) => {
    resumes.set(id, { providerId, cwd });
  },
  respondApproval: (sessionId, id, decision: ApprovalDecision, approvalOccurrenceId?: string) => {
    const live = lives.get(sessionId);
    const pending = live?.approvals.get(id);
    if (
      !live ||
      live.cancelled ||
      !pending ||
      pending.invalidated ||
      !isApprovalOccurrenceId(approvalOccurrenceId) ||
      pending.occurrenceId !== approvalOccurrenceId
    )
      return;
    pending(decision);
  },
  refreshCatalog: refreshGenericAcpCatalog,
};
export function ensureGenericAcpRegistered(): void {
  registerHarness(genericAcpAdapter);
}

export const cancelGenericAcpTurn = genericAcpAdapter.cancelTurn;
export const forgetGenericAcpSession = genericAcpAdapter.forgetSession;
export const stopGenericAcpSession = genericAcpAdapter.stopSession;
export const bindGenericAcpSession = genericAcpAdapter.bindSession;
export const respondGenericAcpApproval = genericAcpAdapter.respondApproval;
export function respondGenericAcpQuestion(): void {
  /* ACP questions are unsupported; capability is not advertised. */
}
