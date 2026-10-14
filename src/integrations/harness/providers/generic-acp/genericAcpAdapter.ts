import { AcpClient, type AcpHandlers } from "../../core/acp";
import { spawnChild, watchChild, killChild, invokeProviderCommand } from "../../core/child";
import { registerHarness, type HarnessAdapter } from "../../core/registry";
import type { ApprovalDecision, HarnessEvent, SendTurnInput } from "../../core/types";
import { promptBlocks } from "../../../../features/sessions/model/attachments";
import { setHarnessModels } from "../../../../features/sessions/model/models";
import type { GenericAcpSummary } from "../../../../features/providers/model/genericAcp";

type Live = {
  client: AcpClient;
  providerId: string;
  configId: string;
  cwd: string;
  onEvent: (event: HarnessEvent) => void;
  cancelled: boolean;
  approvals: Map<number, { options: { optionId: string; kind: string }[] }>;
};
const lives = new Map<string, Live>();
const resumes = new Map<string, { providerId: string; cwd: string }>();
const starting = new Set<string>();
const cancelled = new Set<string>();

async function stop(sessionId: string): Promise<void> {
  const live = lives.get(sessionId);
  lives.delete(sessionId);
  if (live) {
    live.cancelled = true;
    live.client.close(new Error("ACP process stopped"));
  }
  await killChild(sessionId);
}
async function cancel(sessionId: string): Promise<void> {
  const live = lives.get(sessionId);
  if (!live) {
    if (starting.has(sessionId)) {
      cancelled.add(sessionId);
      await killChild(sessionId);
    }
    return;
  }
  live.cancelled = true;
  for (const id of live.approvals.keys())
    await live.client.respond(id, { outcome: { outcome: "cancelled" } });
  live.approvals.clear();
  await live.client.notify("session/cancel", { sessionId: live.providerId }).catch(() => undefined);
  // A noncompliant agent must not leave the turn waiting forever.
  await stop(sessionId);
}

export async function sendGenericAcpTurn(
  input: SendTurnInput,
  program?: { id: string; path: string; args: string[]; model: string },
): Promise<void> {
  const configId = program?.id ?? input.model.replace(/^acp:/, "");
  if (!configId) throw new Error("Choose a configured ACP agent in Settings first");
  let live = lives.get(input.sessionId);
  if (live && (live.configId !== configId || live.cwd !== input.cwd)) {
    await stop(input.sessionId);
    resumes.delete(input.sessionId);
    live = undefined;
  }
  if (!live) {
    starting.add(input.sessionId);
    const handlers: AcpHandlers = {};
    const client = new AcpClient(input.sessionId, handlers);
    const state: Live = {
      client,
      configId,
      cwd: input.cwd,
      providerId: "",
      onEvent: input.onEvent,
      cancelled: false,
      approvals: new Map(),
    };
    handlers.onNotification = (method, params) => {
      if (method !== "session/update" || state.cancelled) return;
      const update = (params as { update?: Record<string, unknown> })?.update;
      if (!update) return;
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
      if (state.cancelled) {
        await client.respond(id, { outcome: { outcome: "cancelled" } });
        return;
      }
      const permission = params as {
        options?: { optionId: string; kind: string }[];
        toolCall?: { title?: string; toolCallId?: string };
      };
      state.approvals.set(id, { options: permission.options ?? [] });
      state.onEvent({
        type: "approval.requested",
        requestId: id,
        title: permission.toolCall?.title ?? "ACP permission",
        callId: permission.toolCall?.toolCallId,
      });
    };
    watchChild(
      input.sessionId,
      (line) => client.pushLine(line),
      (code) => {
        client.close(new Error("ACP agent process exited"));
        if (lives.get(input.sessionId) === state) lives.delete(input.sessionId);
        state.onEvent({ type: "session.ended", code });
      },
    );
    try {
      if (program)
        await spawnChild(
          input.sessionId,
          program.path,
          program.args,
          input.cwd,
          undefined,
          "opencode",
        );
      else await spawnChild(input.sessionId, "", [], input.cwd, undefined, undefined, configId);
      if (cancelled.delete(input.sessionId)) throw new Error("ACP startup cancelled");
      const initialized = await client.request<{
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
        20_000,
      );
      const configs = await invokeProviderCommand<GenericAcpSummary[]>("generic_acp_list");
      const auth = configs.find((config) => config.id === configId)?.authMethodId;
      if (auth) await client.request("authenticate", { methodId: auth }, 60_000);
      const resume = resumes.get(input.sessionId);
      if (resume && resume.cwd === input.cwd && initialized.agentCapabilities?.loadSession) {
        await client.request(
          "session/load",
          { sessionId: resume.providerId, cwd: input.cwd, mcpServers: [] },
          30_000,
        );
        state.providerId = resume.providerId;
      } else {
        if (resume)
          throw new Error(
            "This ACP agent cannot resume its stored session; start a new conversation or hand off explicitly",
          );
        const setup = await client.request<{ sessionId?: string }>(
          "session/new",
          { cwd: input.cwd, mcpServers: [] },
          30_000,
        );
        if (!setup.sessionId) throw new Error("ACP agent returned no session id");
        state.providerId = setup.sessionId;
      }
      if (cancelled.delete(input.sessionId)) throw new Error("ACP startup cancelled");
      lives.set(input.sessionId, state);
      live = state;
      resumes.set(input.sessionId, { providerId: state.providerId, cwd: input.cwd });
      input.onEvent({ type: "session.providerBound", providerSessionId: state.providerId });
    } catch (error) {
      client.close(error instanceof Error ? error : undefined);
      await killChild(input.sessionId);
      throw error;
    } finally {
      starting.delete(input.sessionId);
      cancelled.delete(input.sessionId);
    }
  }
  live.onEvent = input.onEvent;
  live.cancelled = false;
  if (program)
    await live.client.request(
      "session/set_config_option",
      { sessionId: live.providerId, configId: "model", value: program.model },
      30_000,
    );
  input.onEvent({ type: "session.started" });
  try {
    await live.client.request("session/prompt", {
      sessionId: live.providerId,
      prompt: promptBlocks(input.text, input.attachments),
    });
    input.onEvent({ type: "message.completed" });
  } catch (error) {
    if (!live.cancelled) throw error;
  }
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
  forgetSession: async (id) => {
    resumes.delete(id);
    cancelled.delete(id);
    await stop(id);
  },
  bindSession: (id, providerId, cwd) => {
    resumes.set(id, { providerId, cwd });
  },
  respondApproval: (sessionId, id, decision: ApprovalDecision) => {
    const live = lives.get(sessionId);
    const pending = live?.approvals.get(id);
    if (!live || !pending) return;
    live.approvals.delete(id);
    const option = pending.options.find(
      (entry) => entry.kind === (decision === "allow" ? "allow_once" : "reject_once"),
    );
    void live.client
      .respond(id, {
        outcome: option
          ? { outcome: "selected", optionId: option.optionId }
          : { outcome: "cancelled" },
      })
      .then(() => live.onEvent({ type: "approval.resolved", requestId: id, decision }))
      .catch(() => undefined);
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
