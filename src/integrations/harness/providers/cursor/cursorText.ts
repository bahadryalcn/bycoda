import { captureTextInput, prepareTextProcess, runTextOperation } from "../../core/textSource";
import { acpTurnWriter, type AcpWriterView } from "../turnWriter";
import { killChild } from "../../core/child";
import {
  withProviderRetirement,
  observeProviderProbeCleanup,
  createProviderRetirementLedger,
  preserveProviderFailure,
  settleProviderRetirements,
} from "../../core/providerRetirement";
import { continueAfterFailure, settledTail } from "../../../../shared/lib/promiseQueue";
import { asRecord } from "../../../../shared/lib/records";
import { AcpClient } from "../../core/acp";
import {
  captureChildProcess,
  createChildProcessHandle,
  resolveCursorBinary,
  spawnChild,
  watchChild,
  type ChildProcessHandle,
} from "../../core/child";
import { abortTextPromptRace } from "../../core/abortTextPrompt";
import { mergeStream } from "../../core/streamText";
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";

const retirements = createProviderRetirementLedger("cursor.text", killChild);

const TEXT_CHILD_ID = "bycoda-text";
const INIT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const TEXT_MODEL = "composer-2.5";

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  _meta: { parameterizedModelPicker: true },
};

type LiveText = {
  process: ChildProcessHandle;
  acp: AcpClient;
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
let stopGeneration = 0;
let turns: Promise<void> = Promise.resolve();

export async function stopCursorTextPrompt(childId?: string): Promise<void> {
  stopGeneration += 1;
  const extra = childId && childId !== TEXT_CHILD_ID ? captureChildProcess(childId) : undefined;
  await settleProviderRetirements([dropLive(), ...(extra ? [retirements.retire([extra])] : [])]);
}

/** Start the shared text ACP process in the background so the first prompt is fast. */
export function warmupCursorText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const run = continueAfterFailure(turns, async () => {
    await ensureLive(cwd);
  });
  turns = settledTail(run);
  return observeProviderProbeCleanup(run);
}

/** Cursor ACP turn in ask mode. Reuses a warm `cursor-agent acp` process. */
export async function runCursorTextPrompt(input: {
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
    input.model,
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
  const generation = stopGeneration;
  const current = live;
  if (current && !current.closed) {
    prepareTextProcess(current.process, operationContext);
    const writer = await acpTurnWriter(
      current.process,
      current.acp,
      operationContext?.nativeControlTurn,
      operationContext,
    );
    if (live !== current || current.closed || stopGeneration !== generation)
      throw new Error("Cursor text generator stopped");
    if (current.cwd === cwd && current.model === model && current.settingsKey === settingsKey)
      return current;
    try {
      await openSession(current, writer, cwd, model, modelSettings);
      if (stopGeneration !== generation || live !== current || current.closed)
        throw new Error("Cursor text generator stopped");
      return current;
    } catch (error) {
      if (stopGeneration !== generation || (live !== null && live !== current) || starting !== null)
        throw error;
      // startLive reserves/publishes the replacement before retiring this A.
    }
  }
  if (stopGeneration !== generation) throw new Error("Cursor text generator stopped");
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
  const textProcess = createChildProcessHandle(
    TEXT_CHILD_ID,
    operationContext?.nativeControlTurn,
    operationContext?.nativeControlTurn ? undefined : "utility",
  );
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
        const update = messageFromUpdate(params);
        if (!update) return;
        const previous = session.output;
        session.output = update.delta ? previous + update.text : mergeStream(previous, update.text);
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
        if (live === session) live = null;
        acp.close(new Error("Cursor text generator exited"));
      },
    );

    await stopping;
    const { path } = await resolveCursorBinary();
    if (starting !== textProcess) throw new Error("Cursor text startup cancelled");
    await spawnChild(textProcess, path, ["acp"], cwd, undefined, "cursor");
    const writer = await acpTurnWriter(
      textProcess,
      acp,
      operationContext?.nativeControlTurn,
      operationContext,
    );
    await writer.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: { name: "bycoda-text", version: "0.1.0" },
      },
      INIT_TIMEOUT_MS,
    );
    await writer
      .request("authenticate", { methodId: "cursor_login" }, REQUEST_TIMEOUT_MS)
      .catch(() => undefined);
    await openSession(session, writer, cwd, model, modelSettings);
    if (starting !== textProcess || session.closed)
      throw new Error("Cursor text startup cancelled");
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
      settleProviderRetirements([
        stopping,
        ...(admitted ? [retirements.retire([textProcess])] : []),
      ]),
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
  const setup = await writer.request<{
    sessionId?: string;
    configOptions?: unknown;
  }>("session/new", { cwd, mcpServers: [] }, REQUEST_TIMEOUT_MS);
  const acpSessionId = setup.sessionId?.trim();
  if (!acpSessionId) throw new Error("Cursor did not return a session id");

  await writer
    .request("session/set_mode", { sessionId: acpSessionId, modeId: "ask" }, REQUEST_TIMEOUT_MS)
    .catch(() => undefined);

  const modelConfigId = extractModelConfigId(setup.configOptions);
  await writer
    .request(
      "session/set_config_option",
      {
        sessionId: acpSessionId,
        configId: modelConfigId,
        value: model,
      },
      REQUEST_TIMEOUT_MS,
    )
    .catch(() =>
      writer
        .request(
          "session/set_model",
          { sessionId: acpSessionId, modelId: model },
          REQUEST_TIMEOUT_MS,
        )
        .catch(() => undefined),
    );

  for (const [settingId, value] of Object.entries(modelSettings ?? {})) {
    const configId = resolveSettingConfigId(setup.configOptions, settingId);
    if (!configId) continue;
    await writer
      .request(
        "session/set_config_option",
        {
          sessionId: acpSessionId,
          configId,
          value,
        },
        REQUEST_TIMEOUT_MS,
      )
      .catch(() => undefined);
  }

  session.cwd = cwd;
  session.model = model;
  session.settingsKey = modelSettingsKey(modelSettings);
  session.acpSessionId = acpSessionId;
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
}

async function handleTextRequest(acp: AcpWriterView, id: number, method: string, params: unknown) {
  if (method === "session/request_permission") {
    const optionIds = permissionOptionIds(params);
    const optionId = optionIds.find((value) => /reject|deny|cancel/i.test(value)) ?? "reject-once";
    await acp.respond(id, { outcome: { outcome: "selected", optionId } }).catch(() => undefined);
    return;
  }
  if (method === "cursor/ask_question") {
    await acp
      .respond(id, {
        outcome: {
          outcome: "skipped",
          reason: "Text generation does not answer questions",
        },
      })
      .catch(() => undefined);
    return;
  }
  await acp.respond(id, {}).catch(() => undefined);
}
function modelSettingsKey(settings?: Record<string, string>): string {
  return JSON.stringify(settings ?? {});
}

function resolveSettingConfigId(raw: unknown, settingId: string): string | undefined {
  const needle = settingId.trim().toLowerCase();
  const options = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const rec = asRecord(item);
        const id = String(rec?.id ?? rec?.configId ?? "").trim();
        if (!id) return [];
        return [
          {
            id,
            category: String(rec?.category ?? "").trim(),
          },
        ];
      })
    : [];
  const exact = options.find((option) => option.id.toLowerCase() === needle);
  if (exact) return exact.id;
  if (needle === "effort" || needle === "reasoning") {
    return options.find(
      (option) =>
        option.id === "effort" ||
        option.id === "reasoning" ||
        (option.category === "thought_level" && option.id !== "thinking"),
    )?.id;
  }
  if (needle === "fast" || needle === "fastmode") {
    return options.find(
      (option) => option.id === "fast" || option.id.toLowerCase().includes("fast"),
    )?.id;
  }
  if (needle === "thinking") {
    return options.find((option) => option.id === "thinking")?.id;
  }
  if (needle === "context" || needle === "contextwindow") {
    return options.find((option) => option.id === "context" || option.id === "context_size")?.id;
  }
  return undefined;
}

function permissionOptionIds(params: unknown): string[] {
  const rec = asRecord(params);
  const options = Array.isArray(rec?.options) ? rec.options : [];
  return options.flatMap((item) => {
    const id = asRecord(item)?.optionId;
    return typeof id === "string" ? [id] : [];
  });
}

function extractModelConfigId(raw: unknown): string {
  if (!Array.isArray(raw)) return "model";
  for (const item of raw) {
    const rec = asRecord(item);
    const id = String(rec?.id ?? rec?.configId ?? "").trim();
    const category = String(rec?.category ?? "").trim();
    if (id && (category === "model" || id === "model")) return id;
  }
  return "model";
}

function messageFromUpdate(params: unknown): { text: string; delta: boolean } | undefined {
  const rec = asRecord(params);
  const update = asRecord(rec?.update) ?? rec;
  if (!update) return;
  const kind = String(update.sessionUpdate ?? update.session_update ?? update.type ?? "");
  if (kind !== "agent_message_chunk" && kind !== "agent_message") return;
  return {
    text: textFromContent(update.content ?? update.text),
    delta: kind === "agent_message_chunk",
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  const rec = asRecord(content);
  if (rec && typeof rec.text === "string") return rec.text;
  if (rec && rec.content != null) return textFromContent(rec.content);
  if (Array.isArray(content)) {
    return content.map((item) => textFromContent(item)).join("");
  }
  return "";
}
