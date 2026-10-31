import { nativeModelIdWithSettings } from "../../../../features/sessions/model/models";
import { captureTextInput, prepareTextProcess, runTextOperation } from "../../core/textSource";
import { acpTurnWriter, type AcpWriterView } from "../turnWriter";
import { killChild } from "../../core/child";
import {
  withProviderRetirement,
  observeProviderProbeCleanup,
  createProviderRetirementLedger,
  settleProviderRetirements,
  preserveProviderFailure,
} from "../../core/providerRetirement";
import { continueAfterFailure, settledTail } from "../../../../shared/lib/promiseQueue";
import { AcpClient } from "../../core/acp";
import {
  captureChildProcess,
  createChildProcessHandle,
  execChild,
  resolveGrokBinary,
  spawnChild,
  watchChild,
  type ChildProcessHandle,
} from "../../core/child";
import { grokAuthMethodId, grokEffort, grokTextSpawnArgs, TEXT_MODEL } from "./grokProtocol";
import { abortTextPromptRace } from "../../core/abortTextPrompt";
import { mergeStream } from "../../core/streamText";
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";

const retirements = createProviderRetirementLedger("grok.text", killChild);

const TEXT_CHILD_ID = "bycoda-grok-text";
const INIT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};

type LiveText = {
  process: ChildProcessHandle;
  acp: AcpClient;
  binaryPath: string;
  cwd: string;
  model: string;
  settingsKey: string;
  acpSessionId: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  onEvent?: (event: HarnessEvent) => void;
};

let live: LiveText | null = null;
let starting: ChildProcessHandle | null = null;
let turns: Promise<void> = Promise.resolve();

export async function stopGrokTextPrompt(childId?: string): Promise<void> {
  const extra = childId && childId !== TEXT_CHILD_ID ? captureChildProcess(childId) : undefined;
  await settleProviderRetirements([dropLive(), ...(extra ? [retirements.retire([extra])] : [])]);
}

export function warmupGrokText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const run = continueAfterFailure(turns, async () => {
    await ensureLive(cwd);
  });
  turns = settledTail(run);
  return observeProviderProbeCleanup(run);
}

export async function runGrokTextPrompt(input: {
  cwd: string;
  model?: string;
  modelSettings?: Record<string, string>;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
  operationContext?: HarnessOperationContext;
}): Promise<string> {
  input = captureTextInput(input);
  const run = turns
    .catch(() => undefined)
    .then(() => runTextOperation(input.operationContext, () => promptOnLive(input)));
  turns = settledTail(run);
  return run;
}

async function promptOnLive(input: {
  cwd: string;
  model?: string;
  modelSettings?: Record<string, string>;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
  operationContext?: HarnessOperationContext;
}): Promise<string> {
  input.signal?.throwIfAborted();
  const session = await ensureLive(
    input.cwd,
    input.model ? nativeModelIdWithSettings(input.model, input.modelSettings) : undefined,
    input.modelSettings,
    input.operationContext,
  );
  let writer: Awaited<ReturnType<typeof acpTurnWriter>>;
  try {
    prepareTextProcess(session.process, input.operationContext);
    writer = await acpTurnWriter(
      session.process,
      session.acp,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
    );
    input.signal?.throwIfAborted();
  } catch (error) {
    return preserveProviderFailure(error, dropLive(session));
  }
  const acpSessionId = session.acpSessionId;
  const cancel = async () => {
    const original = await acpTurnWriter(
      session.process,
      session.acp,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
      "control",
    );
    return original.notify("session/cancel", { sessionId: acpSessionId });
  };
  session.output = "";
  session.collecting = true;
  session.onEvent = input.onEvent;
  const abort = abortTextPromptRace(input.signal, cancel);
  return withProviderRetirement(
    async () => {
      try {
        await Promise.race([
          writer.request(
            "session/prompt",
            {
              sessionId: acpSessionId,
              prompt: [{ type: "text", text: input.prompt }],
            },
            input.timeoutMs ?? REQUEST_TIMEOUT_MS,
          ),
          ...(abort.promise ? [abort.promise] : []),
        ]);
        return session.output;
      } catch (error) {
        await cancel().catch(() => undefined);
        throw error;
      }
    },
    async () => {
      abort.detach();
      session.collecting = false;
      session.onEvent = undefined;
      await dropLive(session);
    },
  );
}

async function ensureLive(
  cwd: string,
  requestedModel?: string,
  modelSettings?: Record<string, string>,
  operationContext?: HarnessOperationContext,
): Promise<LiveText> {
  const model = requestedModel?.trim() || TEXT_MODEL;
  const settingsKey = modelSettingsKey(modelSettings);
  const current = live;
  if (current && !current.closed) {
    prepareTextProcess(current.process, operationContext);
    await acpTurnWriter(
      current.process,
      current.acp,
      operationContext?.nativeControlTurn,
      operationContext,
    );
    if (live !== current || current.closed) throw new Error("Grok text generator stopped");
  }
  if (
    current &&
    live === current &&
    !current.closed &&
    current.cwd === cwd &&
    current.model === model &&
    current.settingsKey === settingsKey
  )
    return current;
  // Retire the previous throwaway session before replacing its id, including
  // when a warmed-up process needs a different model or working directory.
  return startLive(cwd, model, modelSettings, operationContext);
}

async function startLive(
  cwd: string,
  model = TEXT_MODEL,
  modelSettings?: Record<string, string>,
  operationContext?: HarnessOperationContext,
): Promise<LiveText> {
  const previous = captureDrop();
  let stopping = Promise.resolve();
  const textProcess = createChildProcessHandle(TEXT_CHILD_ID, operationContext?.nativeControlTurn);
  prepareTextProcess(textProcess, operationContext, true);
  const acpRef: { session: LiveText | null } = { session: null };
  let admitted = false;
  try {
    retirements.admitPending(textProcess);
    admitted = true;
    starting = textProcess;
    stopping = dropLive(undefined, previous);
    const acp = new AcpClient(textProcess, {
      onNotification: (method, params) => {
        const session = acpRef.session;
        if (!session || method !== "session/update" || !session.collecting) return;
        const previous = session.output;
        session.output = mergeStream(previous, textFromUpdate(params));
        const delta = session.output.slice(previous.length);
        if (delta) session.onEvent?.({ type: "message.delta", text: delta });
      },
      onRequest: (id, method, params) => {
        void acpTurnWriter(textProcess, acp, operationContext?.nativeControlTurn, operationContext)
          .then((original) => handleTextRequest(original, id, method, params))
          .catch(() => undefined);
      },
    });
    const session: LiveText = {
      process: textProcess,
      acp,
      binaryPath: "",
      cwd,
      model,
      settingsKey: modelSettingsKey(modelSettings),
      acpSessionId: "",
      collecting: false,
      output: "",
      closed: false,
      onEvent: undefined,
    };
    acpRef.session = session;

    watchChild(
      textProcess,
      (line) => acp.pushLine(line),
      () => {
        session.closed = true;
        // Keep the closed session available for history cleanup in dropLive.
        acp.close(new Error("Grok Build text generator exited"));
      },
    );

    await stopping;
    const { path } = await resolveGrokBinary();
    session.binaryPath = path;
    if (starting !== textProcess) throw new Error("Grok text startup cancelled");
    await spawnChild(textProcess, path, grokTextSpawnArgs(), cwd, undefined, "grok");
    const writer = await acpTurnWriter(
      textProcess,
      acp,
      operationContext?.nativeControlTurn,
      operationContext,
    );
    const init = await writer.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "bycoda-text", version: "0.1.0" },
      },
      INIT_TIMEOUT_MS,
    );
    const methodId = grokAuthMethodId(init);
    if (methodId) {
      await writer
        .request("authenticate", { methodId, _meta: { headless: true } }, REQUEST_TIMEOUT_MS)
        .catch(() => undefined);
    }
    await openSession(session, writer, cwd, model, modelSettings);
    if (starting !== textProcess || session.closed) throw new Error("Grok text startup cancelled");
    live = session;
    return session;
  } catch (error) {
    const session = acpRef.session;
    if (session) {
      session.closed = true;
      session.acp.close(error instanceof Error ? error : new Error(String(error)));
    }
    return preserveProviderFailure(
      error,
      (async () => {
        await settleProviderRetirements([
          stopping,
          ...(admitted ? [retirements.retire([textProcess])] : []),
        ]);
        if (session) await deleteTextSession(session);
      })(),
    );
  } finally {
    if (starting === textProcess) starting = null;
  }
}

async function openSession(
  session: LiveText,
  writer: AcpWriterView,
  cwd: string,
  model: string,
  modelSettings?: Record<string, string>,
): Promise<void> {
  const setup = await writer.request<{ sessionId?: string }>(
    "session/new",
    { cwd, mcpServers: [] },
    REQUEST_TIMEOUT_MS,
  );
  const acpSessionId = setup.sessionId?.trim();
  if (!acpSessionId) throw new Error("Grok Build did not return a session id");
  session.acpSessionId = acpSessionId;

  await writer
    .request("session/set_model", { sessionId: acpSessionId, modelId: model }, REQUEST_TIMEOUT_MS)
    .catch(() => undefined);
  await writer
    .request(
      "session/set_mode",
      {
        sessionId: acpSessionId,
        modeId: grokEffort(modelSettings) ?? "low",
      },
      REQUEST_TIMEOUT_MS,
    )
    .catch(() => undefined);

  session.cwd = cwd;
  session.model = model;
  session.settingsKey = modelSettingsKey(modelSettings);
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
    current.acp.close();
  }
  const originals = new Set([current?.process, pending]);
  await (expected
    ? retirements.retire(originals)
    : settleProviderRetirements([snapshot.cohort.retire(), retirements.retire(originals)]));
  // Stop the writer first so it cannot recreate the session after deletion.
  if (current) await deleteTextSession(current);
}

async function deleteTextSession(session: LiveText): Promise<void> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(session.acpSessionId)) return;
  await execChild(
    session.binaryPath,
    ["--no-auto-update", "sessions", "delete", session.acpSessionId],
    session.cwd,
    "grok",
  ).catch((error) => console.debug("[bycoda] Grok text session cleanup", error));
}

async function handleTextRequest(acp: AcpWriterView, id: number, method: string, params: unknown) {
  if (method === "session/request_permission") {
    const optionIds = permissionOptionIds(params);
    const optionId = optionIds.find((value) => /reject|deny|cancel/i.test(value)) ?? "reject-once";
    await acp.respond(id, { outcome: { outcome: "selected", optionId } }).catch(() => undefined);
    return;
  }
  if (method === "_x.ai/ask_user_question" || method === "x.ai/ask_user_question") {
    await acp.respond(id, { outcome: "skip_interview" }).catch(() => undefined);
    return;
  }
  await acp.respond(id, {}).catch(() => undefined);
}

function permissionOptionIds(params: unknown): string[] {
  const rec =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : null;
  const options = Array.isArray(rec?.options) ? rec.options : [];
  return options.flatMap((item) => {
    const id =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>).optionId
        : undefined;
    return typeof id === "string" ? [id] : [];
  });
}

function textFromUpdate(params: unknown): string {
  const rec =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : null;
  const update =
    rec?.update && typeof rec.update === "object" && !Array.isArray(rec.update)
      ? (rec.update as Record<string, unknown>)
      : rec;
  if (!update) return "";
  const kind = String(update.sessionUpdate ?? update.session_update ?? update.type ?? "");
  if (kind !== "agent_message_chunk" && kind !== "agent_message") return "";
  return textFromContent(update.content ?? update.text);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const rec = content as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (rec.content != null) return textFromContent(rec.content);
  }
  if (Array.isArray(content)) {
    return content.map((item) => textFromContent(item)).join("");
  }
  return "";
}

function modelSettingsKey(settings?: Record<string, string>): string {
  return JSON.stringify({ effort: grokEffort(settings) ?? "low" });
}
