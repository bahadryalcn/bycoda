import { resumeCodexThread } from "./codexThreadRecovery";
import { captureTextInput, prepareTextProcess, runTextOperation } from "../../core/textSource";
import { isTauri } from "@tauri-apps/api/core";
import { rpcTurnWriter, type JsonRpcWriterView } from "../turnWriter";
import { killChild } from "../../core/child";
import {
  settleProviderRetirements,
  withProviderRetirement,
  observeProviderProbeCleanup,
  createProviderRetirementLedger,
  preserveProviderFailure,
} from "../../core/providerRetirement";
import { continueAfterFailure, settledTail } from "../../../../shared/lib/promiseQueue";
import { modelsFor } from "../../../../features/sessions/model/models";
import { PRODUCT_IDENTITY } from "../../../../shared/lib/productIdentity";
import {
  createChildProcessHandle,
  resolveCodexBinary,
  spawnChild,
  watchChild,
  type ChildProcessHandle,
} from "../../core/child";
import {
  asRecord,
  buildThreadStartParams,
  buildTurnStartParams,
  mapCodexNotification,
  stringField,
  type CodexTurnUsageState,
} from "./codexProtocol";
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";
import { JsonRpcClient, type JsonRpcId } from "../../core/jsonRpc";
import type { TextPromptInput } from "../../core/registry";

import { mergeStream } from "../../core/streamText";
import { utilityOutputExceeded, validateTextOutputLimit } from "../../core/textOutput";
import {
  assertCodexUtilityIsolation,
  codexUtilityConfig,
  codexUtilitySpawnArgs,
} from "./codexUtilityIsolation";

const retirements = createProviderRetirementLedger("codex.text", killChild);

const TEXT_CHILD_ID = "bycoda-codex-text";
const INIT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 45_000;
// A wedged provider must not hold the shared helper queue during cleanup.
const INTERRUPT_TIMEOUT_MS = 2_000;
const TEXT_RUNTIME_MODE = "supervised" as const;
const TEXT_MODEL = "gpt-5.6-luna";
const TEXT_EFFORT = "low";

type LiveText = {
  process: ChildProcessHandle;
  rpc: JsonRpcClient;
  cwd: string;
  providerAccountId?: string;
  threadId: string;
  ephemeral: boolean;
  model: string;
  effort: string;
  serviceTier?: string;
  collecting: boolean;
  output: string;
  outputLimit?: number;
  reasoningChars?: number;
  closed: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  onEvent?: (event: HarnessEvent) => void;
  compacting?: boolean;
  compaction?: {
    acknowledged: boolean;
    turnId?: string;
    turns: Map<
      string,
      {
        started?: boolean;
        compactStarted?: boolean;
        compactCompleted?: boolean;
        completed?: boolean;
        status?: string;
      }
    >;
  };
  compactedTurnId?: string;
  usage?: CodexTurnUsageState;
};

let live: LiveText | null = null;
let starting: ChildProcessHandle | null = null;
let turns: Promise<void> = Promise.resolve();

function pickTextModel(requested?: string): string {
  const selected = requested?.trim();
  if (selected) return selected;
  const models = modelsFor("codex");
  const luna = models.find((model) =>
    /5\.6-luna/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return luna?.nativeId ?? models.find((model) => model.nativeId)?.nativeId ?? TEXT_MODEL;
}

function pickTextEffort(modelId: string, modelSettings?: Record<string, string>): string {
  const requested = modelSettings?.reasoningEffort?.trim() || modelSettings?.effort?.trim();
  const model = modelsFor("codex").find((entry) => entry.nativeId === modelId);
  const setting = model?.settings?.find((entry) => entry.id === "reasoningEffort");
  const options = setting?.options?.map((option) => option.value) ?? [];
  if (requested && (options.length === 0 || options.includes(requested))) {
    return requested;
  }
  if (options.includes("low")) return "low";
  if (options.includes("none")) return "none";
  if (setting?.value && options.includes(setting.value)) return setting.value;
  return TEXT_EFFORT;
}

function pickTextServiceTier(modelSettings?: Record<string, string>): string | undefined {
  const value = modelSettings?.serviceTier?.trim();
  return value || undefined;
}

export async function stopCodexTextPrompt(): Promise<void> {
  await dropLive();
}

/** Start the shared Codex app-server in the background so the first prompt is fast. */
export function warmupCodexText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const run = continueAfterFailure(turns, async () => {
    await ensureLive({ cwd });
  });
  turns = settledTail(run);
  return observeProviderProbeCleanup(run);
}

/** Codex app-server turn that reuses a warm process, like Cursor text generation. */
export async function runCodexTextPrompt(input: TextPromptInput): Promise<string> {
  input = captureTextInput(input);
  const run = turns
    .catch(() => undefined)
    .then(() => runTextOperation(input.operationContext, () => promptOnLive(input)));
  turns = settledTail(run);
  return run;
}

async function promptOnLive(input: TextPromptInput): Promise<string> {
  input.signal?.throwIfAborted();
  if (
    isTauri() &&
    !input.operationContext?.nativeControlTurn &&
    !input.operationContext?.hostRun &&
    (input.ephemeral === false || input.threadId || input.compactBefore)
  )
    throw new Error("Standalone text generation requires a new ephemeral thread.");
  validateTextOutputLimit(input.maxOutputChars);
  if (input.compactBefore && (input.ephemeral !== false || !input.threadId || !input.onCompacted))
    throw new Error("Codex compaction requires its exact persistent utility thread and receipt.");
  const session = await ensureLive(input);
  let writer: Awaited<ReturnType<typeof rpcTurnWriter>>;
  try {
    prepareTextProcess(session.process, input.operationContext);
    writer = await rpcTurnWriter(
      session.process,
      session.rpc,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
    );
    input.signal?.throwIfAborted();
    await codexUtilityConfig(writer, input.cwd);
    await assertCodexUtilityIsolation(writer, session.threadId);
    input.signal?.throwIfAborted();
    if (input.compactBefore && session.threadId !== input.threadId)
      throw new Error("The original Chief thread could not be resumed for compaction.");
  } catch (error) {
    return preserveProviderFailure(error, dropLive(session), input);
  }
  const threadId = session.threadId;
  const interrupt = async () => {
    const original = await rpcTurnWriter(
      session.process,
      session.rpc,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
      "control",
    );
    return original.request("turn/interrupt", { threadId }, INTERRUPT_TIMEOUT_MS);
  };
  session.output = "";
  session.outputLimit = input.maxOutputChars;
  session.reasoningChars = 0;
  session.collecting = true;
  session.onEvent = input.onEvent;
  session.usage = {};
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const abortPromise = input.signal
    ? new Promise<void>((_, reject) => {
        abortHandler = () => {
          void interrupt().catch(() => undefined);
          reject(new Error("By-the-way request cancelled"));
        };
        input.signal!.addEventListener("abort", abortHandler, { once: true });
        if (input.signal!.aborted) abortHandler();
      })
    : null;

  return withProviderRetirement(
    async () => {
      try {
        if (input.compactBefore) {
          session.compacting = true;
          session.compaction = { acknowledged: false, turns: new Map() };
          const completed = new Promise<void>((resolve, reject) => {
            session.turnDone = resolve;
            session.turnFailed = reject;
          });
          completed.catch(() => undefined);
          const compact = async () => {
            const receipt = await writer.request<{ turn?: { id?: string } }>(
              "thread/compact/start",
              { threadId },
              timeoutMs,
            );
            session.compaction!.acknowledged = true;
            session.compaction!.turnId = receipt.turn?.id;
            settleCompaction(session);
            await completed;
          };
          await Promise.race([
            compact(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Codex text compaction timed out")),
                timeoutMs,
              );
            }),
            ...(abortPromise ? [abortPromise] : []),
          ]);
          clearTimeout(timeout);
          timeout = undefined;
          input.signal?.throwIfAborted();
          await input.onCompacted!({ threadId });
          input.signal?.throwIfAborted();
          session.compacting = false;
          session.compaction = undefined;
          session.output = "";
          session.reasoningChars = 0;
          session.usage = {};
        }
        const turnPromise = new Promise<void>((resolve, reject) => {
          session.turnDone = resolve;
          session.turnFailed = reject;
        });
        turnPromise.catch(() => undefined);

        const turnStart = writer.request(
          "turn/start",
          buildTurnStartParams({
            threadId,
            runtimeMode: TEXT_RUNTIME_MODE,
            prompt: input.prompt,
            model: session.model || undefined,
            effort: session.effort,
            serviceTier: session.serviceTier,
            intent: input.intent,
          }),
          timeoutMs,
        );
        // A rejected text bound must interrupt even while the start ACK is delayed.
        // A completion event alone still cannot replace the start acknowledgement.
        const earlyFailure = turnPromise.then(() => new Promise<never>(() => {}));
        await Promise.race([turnStart, earlyFailure, ...(abortPromise ? [abortPromise] : [])]);

        await Promise.race([
          turnPromise,
          new Promise<void>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Codex text generation timed out")),
              timeoutMs,
            );
          }),
          ...(abortPromise ? [abortPromise] : []),
        ]);

        return session.output;
      } catch (error) {
        await interrupt().catch(() => undefined);
        throw error;
      }
    },
    async () => {
      clearTimeout(timeout);
      if (abortHandler && input.signal) {
        input.signal.removeEventListener("abort", abortHandler);
      }
      session.collecting = false;
      session.turnDone = null;
      session.turnFailed = null;
      await dropLive(session);
    },
    input,
  );
}
async function ensureLive(
  input: import("../../core/providerRetirement").ProviderRetirementObserver & {
    cwd: string;
    providerAccountId?: string;
    model?: string;
    modelSettings?: Record<string, string>;
    ephemeral?: boolean;
    threadId?: string;
    onThreadId?: (threadId: string) => void | Promise<void>;
    operationContext?: HarnessOperationContext;
  },
): Promise<LiveText> {
  const model = pickTextModel(input.model);
  const effort = pickTextEffort(model, input.modelSettings);
  const serviceTier = pickTextServiceTier(input.modelSettings);
  // Titles, commit messages, branch names, and PR content must never become
  // saved Codex conversations. Only resumable side questions opt into storage.
  const ephemeral = input.ephemeral ?? true;
  const requestedThreadId = ephemeral ? undefined : input.threadId?.trim() || undefined;
  if (live && !live.closed) {
    const original = live;
    prepareTextProcess(original.process, input.operationContext);
    const writer = await rpcTurnWriter(
      original.process,
      original.rpc,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
    );
    if (live !== original || original.closed) throw new Error("Codex text generator stopped");
    if (
      live.cwd === input.cwd &&
      live.model === model &&
      live.effort === effort &&
      live.serviceTier === serviceTier &&
      live.providerAccountId === input.providerAccountId &&
      live.ephemeral === ephemeral &&
      (!requestedThreadId || live.threadId === requestedThreadId)
    ) {
      await confirmThread(live, input.onThreadId, input);
      return live;
    }
    if (live.providerAccountId !== input.providerAccountId) {
      const started = await startLive(
        input.cwd,
        input.providerAccountId,
        model,
        effort,
        serviceTier,
        requestedThreadId,
        ephemeral,
        input.operationContext,
        input,
      );
      await confirmThread(started, input.onThreadId, input);
      return started;
    }
    const current = live;
    try {
      current.model = model;
      current.effort = effort;
      current.serviceTier = serviceTier;
      await openThread(current, writer, input.cwd, requestedThreadId, ephemeral);
      if (live !== current || current.closed) throw new Error("Codex text generator stopped");
      await input.onThreadId?.(current.threadId);
      return current;
    } catch (error) {
      return preserveProviderFailure(error, dropLive(current), input);
    }
  }
  const started = await startLive(
    input.cwd,
    input.providerAccountId,
    model,
    effort,
    serviceTier,
    requestedThreadId,
    ephemeral,
    input.operationContext,
    input,
  );
  await confirmThread(started, input.onThreadId, input);
  return started;
}
async function confirmThread(
  session: LiveText,
  save?: TextPromptInput["onThreadId"],
  retirement?: import("../../core/providerRetirement").ProviderRetirementObserver,
) {
  try {
    await save?.(session.threadId);
  } catch (error) {
    return preserveProviderFailure(error, dropLive(session), retirement);
  }
}

async function startLive(
  cwd: string,
  providerAccountId?: string,
  model = pickTextModel(),
  effort = pickTextEffort(model),
  serviceTier?: string,
  requestedThreadId?: string,
  ephemeral = true,
  operationContext?: HarnessOperationContext,
  retirement?: import("../../core/providerRetirement").ProviderRetirementObserver,
): Promise<LiveText> {
  const previous = captureDrop();
  let stopping = Promise.resolve();
  const textProcess = createChildProcessHandle(
    TEXT_CHILD_ID,
    operationContext?.nativeControlTurn,
    operationContext?.nativeControlTurn ? undefined : "utility",
  );
  prepareTextProcess(textProcess, operationContext, true);
  const sessionRef: { session: LiveText | null } = { session: null };
  let admitted = false;
  try {
    retirements.admitPending(textProcess);
    admitted = true;
    starting = textProcess;
    stopping = dropLive(undefined, previous);
    const rpc = new JsonRpcClient(
      textProcess,
      {
        onNotification: (method, params) => {
          handleNotification(sessionRef.session, method, params);
        },
        onRequest: (id, method, params) => {
          void rpcTurnWriter(
            textProcess,
            rpc,
            operationContext?.nativeControlTurn,
            operationContext,
          )
            .then((original) =>
              handleServerRequest(original, id, method, params, sessionRef.session),
            )
            .catch(() => {
              if (sessionRef.session) failUtilityTool(sessionRef.session);
            });
        },
      },
      { includeJsonrpc: false, label: "codex-text" },
    );

    const session: LiveText = {
      process: textProcess,
      rpc,
      cwd,
      providerAccountId,
      threadId: "",
      ephemeral,
      model,
      effort,
      serviceTier,
      collecting: false,
      output: "",
      closed: false,
      turnDone: null,
      turnFailed: null,
    };

    sessionRef.session = session;

    watchChild(
      textProcess,
      (line) => rpc.pushLine(line),
      () => {
        session.closed = true;
        if (live === session) live = null;
        session.turnFailed?.(new Error("Codex text generator exited"));
        session.turnDone = null;
        session.turnFailed = null;
        rpc.close(new Error("Codex text generator exited"));
      },
    );

    await stopping;
    const { path } = await resolveCodexBinary();
    if (starting !== textProcess) throw new Error("Codex text startup cancelled");
    await spawnChild(
      textProcess,
      path,
      codexUtilitySpawnArgs(),
      cwd,
      {
        provider: "codex",
        id: providerAccountId ?? "default",
      },
      "codex",
    );
    const writer = await rpcTurnWriter(
      textProcess,
      rpc,
      operationContext?.nativeControlTurn,
      operationContext,
    );
    await writer.request(
      "initialize",
      {
        clientInfo: {
          name: "bycoda-text",
          title: PRODUCT_IDENTITY.displayName,
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      },
      INIT_TIMEOUT_MS,
    );
    await writer.notify("initialized", undefined);
    await openThread(session, writer, cwd, requestedThreadId, ephemeral);
    if (starting !== textProcess || session.closed) throw new Error("Codex text startup cancelled");
    live = session;
    return session;
  } catch (error) {
    const session = sessionRef.session;
    if (session) {
      session.closed = true;
      session.rpc.close(error instanceof Error ? error : new Error(String(error)));
    }
    return preserveProviderFailure(
      error,
      settleProviderRetirements([
        stopping,
        ...(admitted ? [retirements.retire([textProcess])] : []),
      ]),
      retirement,
    );
  } finally {
    if (starting === textProcess) starting = null;
  }
}

async function openThread(
  session: LiveText,
  writer: JsonRpcWriterView,
  cwd: string,
  requestedThreadId: string | undefined,
  ephemeral: boolean,
): Promise<void> {
  const config = await codexUtilityConfig(writer, cwd);
  let opened: { thread?: { id?: string } } | undefined;
  if (requestedThreadId) {
    opened = await resumeCodexThread<{ thread?: { id?: string } }>(
      writer,
      requestedThreadId,
      {
        threadId: requestedThreadId,
        // Only the id is consumed here; keep image-heavy history in Codex.
        excludeTurns: true,
        ...buildThreadStartParams({
          cwd,
          runtimeMode: TEXT_RUNTIME_MODE,
          model: session.model || undefined,
          serviceTier: session.serviceTier,
        }),
        config,
      },
      INIT_TIMEOUT_MS,
    );
  }
  if (!opened) {
    opened = await writer.request<{ thread?: { id?: string } }>(
      "thread/start",
      {
        ...buildThreadStartParams({
          cwd,
          runtimeMode: TEXT_RUNTIME_MODE,
          model: session.model || undefined,
          serviceTier: session.serviceTier,
        }),
        ...(ephemeral ? { ephemeral: true } : {}),
        config,
      },
      INIT_TIMEOUT_MS,
    );
  }
  const threadId = opened.thread?.id?.trim();
  if (!threadId) throw new Error("Codex did not return a thread id");
  await assertCodexUtilityIsolation(writer, threadId);
  session.cwd = cwd;
  session.threadId = threadId;
  session.ephemeral = ephemeral;
}
function captureDrop() {
  return {
    current: live,
    pending: starting,
    cohort: retirements.cohort(TEXT_CHILD_ID),
  };
}
async function dropLive(
  expected?: LiveText,
  captured?: ReturnType<typeof captureDrop>,
): Promise<void> {
  const snapshot = captured ?? captureDrop();
  const current = expected ?? snapshot.current;
  const pending = expected ? null : snapshot.pending;
  if (live === current) live = null;
  if (starting === pending) starting = null;
  if (current) {
    current.closed = true;
    current.rpc.close();
  }
  const originals = new Set([current?.process, pending]);
  await (expected
    ? retirements.retire(originals)
    : settleProviderRetirements([snapshot.cohort.retire(), retirements.retire(originals)]));
}

function settleCompaction(session: LiveText) {
  const compact = session.compaction;
  if (!compact?.acknowledged) return;
  const candidates = compact.turnId
    ? [compact.turns.get(compact.turnId)]
    : [...compact.turns.values()].filter(
        (turn) =>
          turn.started &&
          turn.compactStarted &&
          (turn.compactCompleted || (turn.completed && turn.status !== "completed")),
      );
  if (candidates.length > 1) {
    session.turnFailed?.(new Error("Codex compaction completion is ambiguous."));
    return;
  }
  const turn = candidates[0];
  if (!turn?.completed) return;
  if (turn.status === "completed") {
    session.compactedTurnId =
      compact.turnId ?? [...compact.turns.entries()].find(([, value]) => value === turn)?.[0];
    session.turnDone?.();
  } else session.turnFailed?.(new Error("Codex did not confirm successful compaction."));
}
function handleNotification(session: LiveText | null, method: string, params: unknown): void {
  if (session && utilityToolNotification(method, params)) {
    failUtilityTool(session);
    return;
  }
  if (
    session &&
    !session.compacting &&
    method === "turn/completed" &&
    stringField(asRecord(asRecord(params)?.turn), "id") === session.compactedTurnId &&
    session.compactedTurnId
  )
    return;
  if (session?.compacting) {
    const record = asRecord(params),
      thread = stringField(record, "threadId"),
      turn = asRecord(record?.turn),
      id = stringField(turn, "id") ?? stringField(record, "turnId");
    if (thread !== session.threadId) return;
    if (id && session.compaction) {
      let state = session.compaction.turns.get(id);
      if (!state && session.compaction.turns.size < 8) {
        state = {};
        session.compaction.turns.set(id, state);
      }
      if (state) {
        if (method === "turn/started") state.started = true;
        if (method === "turn/completed") {
          state.completed = true;
          state.status = stringField(turn, "status");
        }
        if (stringField(asRecord(record?.item), "type") === "contextCompaction") {
          if (method === "item/started") state.compactStarted = true;
          if (method === "item/completed") state.compactCompleted = true;
        }
        settleCompaction(session);
      }
    }
  }
  if (!session || !session.collecting) {
    if (session && method === "turn/completed") {
      session.turnDone?.();
      session.turnDone = null;
      session.turnFailed = null;
    }
    return;
  }

  const mapped = mapCodexNotification(method, params, session.usage);
  for (const event of mapped.events) {
    const previousOutput = session.output;
    const output =
      event.type === "message.delta"
        ? method === "item/agentMessage/delta"
          ? session.output + event.text
          : mergeStream(session.output, event.text)
        : session.output;
    const reasoningChars =
      (session.reasoningChars ?? 0) + (event.type === "reasoning.delta" ? event.text.length : 0);
    if (utilityOutputExceeded(output, reasoningChars, session.outputLimit)) {
      session.collecting = false;
      session.turnFailed?.(
        new Error(
          "The utility response exceeded its local text allowance; provider usage is uncertain.",
        ),
      );
      return;
    }
    session.output = output;
    session.reasoningChars = reasoningChars;
    if (event.type === "message.delta") {
      const delta = output.slice(previousOutput.length);
      if (delta) session.onEvent?.({ ...event, text: delta });
    } else session.onEvent?.(event);
  }

  if (method === "item/agentMessage/delta") {
    return;
  }

  if (method === "turn/completed") {
    if (session.compacting) return; // settled only by exact compaction proof above
    const turn = asRecord(asRecord(params)?.turn);
    const status = stringField(turn, "status") ?? "completed";
    if (status === "failed") {
      const message = stringField(asRecord(turn?.error), "message") ?? "Codex turn failed";
      session.turnFailed?.(new Error(message));
    } else {
      session.turnDone?.();
    }
    session.turnDone = null;
    session.turnFailed = null;
  }
}

async function handleServerRequest(
  rpc: JsonRpcWriterView,
  id: JsonRpcId,
  method: string,
  _params: unknown,
  session: LiveText | null,
): Promise<void> {
  // Deny protocol-mediated requests before authorizing anything. Notifications
  // may arrive after a provider-owned effect, so config gates remain essential.
  try {
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      await rpc.respond(id, { decision: "decline" }).catch(() => undefined);
      return;
    }
    if (method === "item/permissions/requestApproval") {
      await rpc.respond(id, { permissions: {} }).catch(() => undefined);
      return;
    }
    await rpc.respond(id, {}).catch(() => undefined);
  } finally {
    if (session) failUtilityTool(session);
  }
}

function utilityToolNotification(method: string, params: unknown): boolean {
  if (method === "item/started" || method === "item/completed") {
    const type = stringField(asRecord(asRecord(params)?.item), "type");
    return (
      !type || !["agentMessage", "userMessage", "reasoning", "contextCompaction"].includes(type)
    );
  }
  return (
    method.startsWith("item/") &&
    !/^item\/(?:agentMessage|reasoning|contextCompaction)\//.test(method)
  );
}
function failUtilityTool(session: LiveText): void {
  session.collecting = false;
  session.turnFailed?.(
    new Error("An unexpected utility tool request stopped reasoning; provider usage is uncertain."),
  );
  void dropLive(session).catch(() => undefined);
}
