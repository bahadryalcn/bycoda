import { captureTextInput, prepareTextProcess, runTextOperation } from "../../core/textSource";
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
  isRecoverableThreadResumeError,
  mapCodexNotification,
  stringField,
} from "./codexProtocol";
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";
import { JsonRpcClient, type JsonRpcId } from "../../core/jsonRpc";
import type { TextPromptInput } from "../../core/registry";

import { mergeStream } from "../../core/streamText";

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
  closed: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  onEvent?: (event: HarnessEvent) => void;
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
  } catch (error) {
    return preserveProviderFailure(error, dropLive(session));
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
  session.collecting = true;
  session.onEvent = input.onEvent;
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
        const turnPromise = new Promise<void>((resolve, reject) => {
          session.turnDone = resolve;
          session.turnFailed = reject;
        });

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
        await Promise.race([turnStart, ...(abortPromise ? [abortPromise] : [])]);

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
  );
}
async function ensureLive(input: {
  cwd: string;
  providerAccountId?: string;
  model?: string;
  modelSettings?: Record<string, string>;
  ephemeral?: boolean;
  threadId?: string;
  onThreadId?: (threadId: string) => void;
  operationContext?: HarnessOperationContext;
}): Promise<LiveText> {
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
      input.onThreadId?.(live.threadId);
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
      );
      input.onThreadId?.(started.threadId);
      return started;
    }
    const current = live;
    try {
      current.model = model;
      current.effort = effort;
      current.serviceTier = serviceTier;
      await openThread(current, writer, input.cwd, requestedThreadId, ephemeral);
      if (live !== current || current.closed) throw new Error("Codex text generator stopped");
      input.onThreadId?.(current.threadId);
      return current;
    } catch (error) {
      return preserveProviderFailure(error, dropLive(current));
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
  );
  input.onThreadId?.(started.threadId);
  return started;
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
): Promise<LiveText> {
  const previous = captureDrop();
  let stopping = Promise.resolve();
  const textProcess = createChildProcessHandle(TEXT_CHILD_ID, operationContext?.nativeControlTurn);
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
            .then((original) => handleServerRequest(original, id, method, params))
            .catch(() => undefined);
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
      ["app-server"],
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
  let opened: { thread?: { id?: string } } | undefined;
  if (requestedThreadId) {
    try {
      opened = await writer.request<{ thread?: { id?: string } }>(
        "thread/resume",
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
        },
        INIT_TIMEOUT_MS,
      );
    } catch (error) {
      if (!isRecoverableThreadResumeError(error)) throw error;
      opened = undefined;
    }
    if (!opened?.thread?.id?.trim()) opened = undefined;
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
      },
      INIT_TIMEOUT_MS,
    );
  }
  const threadId = opened.thread?.id?.trim();
  if (!threadId) throw new Error("Codex did not return a thread id");
  session.cwd = cwd;
  session.threadId = threadId;
  session.ephemeral = ephemeral;
}
function captureDrop() {
  return { current: live, pending: starting, cohort: retirements.cohort(TEXT_CHILD_ID) };
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

function handleNotification(session: LiveText | null, method: string, params: unknown): void {
  if (!session || !session.collecting) {
    if (session && method === "turn/completed") {
      session.turnDone?.();
      session.turnDone = null;
      session.turnFailed = null;
    }
    return;
  }

  const mapped = mapCodexNotification(method, params);
  for (const event of mapped.events) {
    session.onEvent?.(event);
    if (event.type === "message.delta") session.output = mergeStream(session.output, event.text);
  }

  if (method === "item/agentMessage/delta") {
    return;
  }

  if (method === "turn/completed") {
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
): Promise<void> {
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
}
