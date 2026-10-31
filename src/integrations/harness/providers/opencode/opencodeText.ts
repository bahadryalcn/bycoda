import { captureHttpOperation } from "../turnWriter";
import {
  captureTextInput,
  prepareTextProcess,
  runTextOperation,
  textControlRun,
} from "../../core/textSource";
import { killChild } from "../../core/child";
import {
  observeProviderProbeCleanup,
  preserveProviderFailure,
  withProviderRetirement,
  createProviderRetirementLedger,
  ProviderRetirementError,
  settleProviderRetirements,
} from "../../core/providerRetirement";
import { continueAfterFailure, settledTail } from "../../../../shared/lib/promiseQueue";
import { modelsFor } from "../../../../features/sessions/model/models";
import type { TurnIntent } from "../../../../features/sessions/model/session";
import {
  createChildProcessHandle,
  execChild,
  freeHarnessPort,
  resolveOpenCodeBinary,
  spawnChild,
  watchChild,
  type ChildProcessHandle,
} from "../../core/child";
import { OpenCodeClient } from "./opencodeClient";
import { abortTextPromptRace } from "../../core/abortTextPrompt";
import { streamTextDelta } from "../../core/streamText";
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";
import {
  appendOpenCodeAssistantTextDelta,
  asRecord,
  assertSupportedOpenCodeVersion,
  eventSessionId,
  KNOWN_HIDDEN_AGENTS,
  mergeOpenCodeAssistantText,
  parseOpenCodeModelSlug,
  parseOpenCodeVersion,
  parseServerUrlFromOutput,
  stringField,
  textDeltaEvent,
  type OpenCodePart,
} from "./opencodeProtocol";
import { resolveOpenCodeV2Service } from "./opencodeService";

const retirements = createProviderRetirementLedger("opencode.text", killChild);
const wireRetirements = new Map<LiveText | TextSetup, Promise<void>>();

const TEXT_CHILD_ID = "bycoda-opencode-text";
const SERVER_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 45_000;

type LiveText = {
  child?: ChildProcessHandle;
  closed: boolean;
  stop?: Promise<void>;
  client: OpenCodeClient;
  cleanupClient: OpenCodeClient;
  hostScoped: boolean;
  sessionId: string;
  cwd: string;
  model: { providerID: string; modelID: string };
  modelSettingsKey: string;
  modelSettings?: Record<string, string>;
  messageRoleById: Map<string, "assistant" | "user" | "hidden">;
  partById: Map<string, OpenCodePart>;
  emittedTextByPartId: Map<string, string>;
  pendingTextDeltaByPartId: Map<string, string>;
  onEvent?: (event: HarnessEvent) => void;
};

let live: LiveText | null = null;
type TextSetup = {
  child?: ChildProcessHandle;
  cancelled: boolean;
  serverUrl: string;
  stop?: Promise<void>;
  createWork?: Promise<{ base: OpenCodeClient; cleanupClient: OpenCodeClient; id: string }>;
  transferred?: boolean;
};
let pendingSetup: TextSetup | null = null;
let turns: Promise<void> = Promise.resolve();

export async function stopOpenCodeTextPrompt(): Promise<void> {
  await dropLive();
}

export function warmupOpenCodeText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const run = continueAfterFailure(turns, async () => {
    await ensureLive(cwd);
  });
  turns = settledTail(run);
  return observeProviderProbeCleanup(run);
}

export async function runOpenCodeTextPrompt(input: {
  cwd: string;
  model?: string;
  modelSettings?: Record<string, string>;
  intent?: TurnIntent;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
  operationContext?: HarnessOperationContext;
}): Promise<string> {
  input = captureTextInput(input);
  // HTTP requests retain their own source view. SSE subscription/close remains
  // an explicitly separate observation path, never a child stdin/run ACK.
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
  intent?: TurnIntent;
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
  const writer = input.operationContext?.hostRun
    ? session.client.withHostRun(input.operationContext.hostRun, session.sessionId)
    : session.client;
  const cleanup = input.operationContext?.hostRun
    ? session.client.withHostRun(textControlRun(input.operationContext)!, session.sessionId)
    : session.cleanupClient;
  captureHttpOperation(session, input.operationContext).begin();
  session.onEvent = input.onEvent;
  const abort = abortTextPromptRace(input.signal, () => cleanup.abortSession(session.sessionId));
  return withProviderRetirement(
    async () => {
      input.signal?.throwIfAborted();
      const result = await Promise.race([
        writer.prompt({
          sessionID: session.sessionId,
          model: session.model,
          agent: openCodeTextAgent(input.intent, session.modelSettings),
          variant: session.modelSettings?.variant,
          parts: [{ type: "text", text: input.prompt }],
          timeoutMs: input.timeoutMs ?? REQUEST_TIMEOUT_MS,
        }),
        ...(abort.promise ? [abort.promise] : []),
      ]);
      const error = result.info?.error;
      if (error) {
        throw new Error(
          typeof error === "object" && error && "message" in error
            ? String((error as { message: unknown }).message)
            : "OpenCode text generation failed",
        );
      }
      const text = getOpenCodeTextResponse(result.parts);
      if (!text) throw new Error("OpenCode returned empty output.");
      return text;
    },
    async () => {
      abort.detach();
      session.onEvent = undefined;
      await dropLive(session, undefined, cleanup);
    },
  );
}

async function ensureLive(
  cwd: string,
  requestedModel?: string,
  modelSettings?: Record<string, string>,
  operationContext?: HarnessOperationContext,
): Promise<LiveText> {
  const model = pickTextModel(requestedModel);
  const settingsKey = modelSettingsKey(modelSettings);
  const current = live;
  if (current && !current.closed && current.hostScoped && !operationContext?.hostRun)
    throw new Error("Original Host run is required for this text HTTP operation");
  if (
    current &&
    !current.closed &&
    current.cwd === cwd &&
    sameModel(current.model, model) &&
    current.modelSettingsKey === settingsKey
  ) {
    if (current.child) prepareTextProcess(current.child, operationContext);
    return current;
  }
  return startLive(cwd, model, modelSettings, captureDrop(), operationContext);
}

async function startLive(
  cwd: string,
  model: { providerID: string; modelID: string },
  modelSettings: Record<string, string> | undefined,
  previous: ReturnType<typeof captureDrop>,
  operationContext?: HarnessOperationContext,
): Promise<LiveText> {
  if (wireRetirements.size + (live ? 1 : 0) + (pendingSetup ? 1 : 0) >= 512)
    throw new ProviderRetirementError(
      "opencode.wire",
      [],
      "Original text cleanup capacity exhausted",
    );
  const setup: TextSetup = { cancelled: false, serverUrl: "" };
  const source = captureHttpOperation(setup, operationContext, "starting");
  source.begin();
  pendingSetup = setup;
  let session: LiveText | undefined;
  let stopping = Promise.resolve();
  const assertCurrent = () => {
    if (setup.cancelled || (session ? session.closed : pendingSetup !== setup))
      throw new Error("OpenCode text generator stopped");
  };
  try {
    const { path } = await resolveOpenCodeBinary();
    assertCurrent();
    const versionOut = await execChild(path, ["--version"], cwd, "opencode").catch(() => "");
    assertCurrent();
    const version = parseOpenCodeVersion(versionOut);
    const generation = assertSupportedOpenCodeVersion(version);
    // Reserve a physical B only after transport discovery, before any A
    // teardown. v2 owns a logical pending HTTP request, never a fake child.
    if (generation === "v1") {
      const child = createChildProcessHandle(TEXT_CHILD_ID, operationContext?.nativeControlTurn);
      prepareTextProcess(child, operationContext, true);
      setup.child = retirements.admitPending(child);
    }
    stopping = dropLive(undefined, previous);
    await stopping;
    assertCurrent();
    const service = generation === "v2" ? await resolveOpenCodeV2Service(path, cwd) : undefined;
    assertCurrent();
    setup.serverUrl = service?.url ?? "";
    if (generation === "v1") {
      const child = setup.child!;
      const observeUrl = (line: string) => {
        const parsed = parseServerUrlFromOutput(line);
        if (parsed && !setup.cancelled) setup.serverUrl = parsed;
      };
      watchChild(
        child,
        observeUrl,
        () => {
          setup.cancelled = true;
          if (session) session.closed = true;
          if (live === session) live = null;
        },
        observeUrl,
      );
      const port = await freeHarnessPort();
      assertCurrent();
      await spawnChild(
        child,
        path,
        ["serve", `--hostname=127.0.0.1`, `--port=${port}`],
        cwd,
        undefined,
        "opencode",
      );
      assertCurrent();
    }
    const url =
      generation === "v2"
        ? setup.serverUrl
        : await waitForUrl(() => setup.serverUrl, SERVER_TIMEOUT_MS);
    assertCurrent();
    const base = new OpenCodeClient(url, cwd, generation, service?.password, TEXT_CHILD_ID);
    const bootstrap = operationContext?.hostRun ? base.withHostRun(operationContext.hostRun) : base;
    setup.createWork = bootstrap
      .createSession({ permission: [{ permission: "*", pattern: "*", action: "deny" }] })
      .then((created) => ({
        // Late/cancelled creation needs only the original cleanup view. Never
        // open a new normal binding just to retire this response.
        base,
        cleanupClient: operationContext?.hostRun
          ? base.withHostRun(textControlRun(operationContext)!, created.id)
          : base,
        id: created.id,
      }));
    const created = await setup.createWork;
    assertCurrent();
    const client = operationContext?.hostRun
      ? created.base.withHostRun(operationContext.hostRun, created.id)
      : created.base;
    const current: LiveText = {
      child: setup.child,
      closed: false,
      client,
      cleanupClient: created.cleanupClient,
      hostScoped: operationContext?.hostRun !== undefined,
      sessionId: created.id,
      cwd,
      model,
      modelSettingsKey: modelSettingsKey(modelSettings),
      modelSettings,
      messageRoleById: new Map(),
      partById: new Map(),
      emittedTextByPartId: new Map(),
      pendingTextDeltaByPartId: new Map(),
      onEvent: undefined,
    };
    session = current;
    setup.transferred = true;
    if (pendingSetup === setup) pendingSetup = null;
    live = current;
    await client.subscribeEvents(
      TEXT_CHILD_ID,
      (event) => handleTextEvent(current, event),
      () => undefined,
    );
    assertCurrent();
    return current;
  } catch (error) {
    return preserveProviderFailure(
      error,
      settleProviderRetirements([stopping, session ? dropLive(session) : stopSetup(setup)]),
    );
  }
}

function handleTextEvent(session: LiveText, event: Record<string, unknown>): void {
  const sessionId = eventSessionId(event);
  if (sessionId && sessionId !== session.sessionId) return;
  const properties = asRecord(event.properties) ?? {};
  if (event.type === "message.updated") {
    const info = asRecord(properties.info);
    const id = stringField(info, "id");
    const role = stringField(info, "role");
    const agent = stringField(info, "agent");
    if (!id || (role !== "assistant" && role !== "user")) return;
    const resolvedRole =
      role === "assistant" && agent && KNOWN_HIDDEN_AGENTS.has(agent) ? "hidden" : role;
    session.messageRoleById.set(id, resolvedRole);
    if (resolvedRole === "assistant") {
      for (const part of session.partById.values()) {
        if (part.messageID === id) emitTextPart(session, part);
      }
    }
    return;
  }
  if (event.type === "message.part.updated") {
    let part = parseTextPart(properties.part);
    if (!part) return;
    const pendingDelta = session.pendingTextDeltaByPartId.get(part.id);
    if (pendingDelta) {
      if (part.time?.end === undefined) {
        part = {
          ...part,
          text: mergeOpenCodeAssistantText(pendingDelta, part.text ?? "").latestText,
        };
      }
      session.pendingTextDeltaByPartId.delete(part.id);
    }
    part = mergeTextPart(session.partById.get(part.id), part);
    session.partById.set(part.id, part);
    if (textPartRole(session, part) === "assistant") {
      emitTextPart(session, part);
    }
    return;
  }
  if (event.type !== "message.part.delta") return;
  const partId = stringField(properties, "partID");
  const delta = streamTextDelta(properties.delta);
  const existing = partId ? session.partById.get(partId) : undefined;
  if (!partId || !delta) return;
  if (!existing) {
    const pending = session.pendingTextDeltaByPartId.get(partId) ?? "";
    session.pendingTextDeltaByPartId.set(partId, pending + delta);
    return;
  }
  // OpenCode publishes the completed part snapshot with time.end after all
  // text deltas. If SSE delivery reorders those publications, the snapshot
  // already contains any delta that arrives after it.
  if (existing.time?.end !== undefined) return;
  const previous = session.emittedTextByPartId.get(existing.id) ?? existing.text ?? "";
  const next = appendOpenCodeAssistantTextDelta(previous, delta);
  const nextPart = {
    ...existing,
    text: next.nextText,
  };
  session.partById.set(existing.id, nextPart);
  if (textPartRole(session, nextPart) !== "assistant") return;
  session.emittedTextByPartId.set(existing.id, next.nextText);
  const mapped = textDeltaEvent(nextPart, next.deltaToEmit);
  if (mapped) session.onEvent?.(mapped);
}

function emitTextPart(session: LiveText, part: OpenCodePart): void {
  if (part.type !== "text" && part.type !== "reasoning") return;
  if (part.text === undefined) return;
  const previous = session.emittedTextByPartId.get(part.id);
  const next = mergeOpenCodeAssistantText(previous, part.text);
  session.emittedTextByPartId.set(part.id, next.latestText);
  const mapped = textDeltaEvent(part, next.deltaToEmit);
  if (mapped) session.onEvent?.(mapped);
}

function textPartRole(
  session: LiveText,
  part: OpenCodePart,
): "assistant" | "user" | "hidden" | undefined {
  return part.messageID ? session.messageRoleById.get(part.messageID) : undefined;
}

function parseTextPart(value: unknown): OpenCodePart | null {
  const record = asRecord(value);
  const id = stringField(record, "id");
  const type = stringField(record, "type");
  if (!record || !id || (type !== "text" && type !== "reasoning")) {
    return null;
  }
  const time = asRecord(record.time);
  const start = typeof time?.start === "number" ? time.start : undefined;
  const end = typeof time?.end === "number" ? time.end : undefined;
  return {
    id,
    type,
    messageID: stringField(record, "messageID"),
    text: typeof record.text === "string" ? record.text : undefined,
    time: start !== undefined || end !== undefined ? { start, end } : undefined,
  };
}

function mergeTextPart(previous: OpenCodePart | undefined, next: OpenCodePart): OpenCodePart {
  if (!previous) return next;
  if (previous.time?.end !== undefined && next.time?.end === undefined) {
    return previous;
  }
  return {
    ...next,
    text: mergeOpenCodeAssistantText(previous.text, next.text ?? "").latestText,
    time: next.time ?? previous.time,
  };
}

function retainTextWireRetirement(owner: LiveText | TextSetup, work: Promise<void>): void {
  wireRetirements.set(owner, work);
  const clear = () => {
    if (wireRetirements.get(owner) === work) wireRetirements.delete(owner);
  };
  void work.then(clear, clear);
}

function stopSetup(setup: TextSetup): Promise<void> {
  setup.cancelled = true;
  if (pendingSetup === setup) pendingSetup = null;
  if (!setup.stop) {
    const child = setup.child;
    const createWork = setup.createWork;
    setup.stop = settleProviderRetirements([
      ...(child ? [retirements.retire([child])] : []),
      ...(createWork
        ? [
            (async () => {
              const created = await createWork;
              if (setup.transferred) return;
              const failures: unknown[] = [];
              for (const effect of [
                () => created.cleanupClient.abortSession(created.id),
                () => created.cleanupClient.deleteSession(created.id),
              ]) {
                try {
                  await effect();
                } catch (error) {
                  failures.push(error);
                }
              }
              if (failures.length) throw new ProviderRetirementError("opencode.wire", failures);
            })(),
          ]
        : []),
    ]);
    retainTextWireRetirement(setup, setup.stop);
  }
  return setup.stop;
}

function captureDrop() {
  return {
    current: live,
    setup: pendingSetup,
    wire: [...wireRetirements.values()],
    cohort: retirements.cohort(TEXT_CHILD_ID),
  };
}
async function dropLive(
  expected?: LiveText,
  captured?: ReturnType<typeof captureDrop>,
  originalClient?: OpenCodeClient,
): Promise<void> {
  const snapshot = captured ?? captureDrop();
  const current = expected ?? snapshot.current;
  const setup = expected ? null : snapshot.setup;
  // Capture physical ownership before any provider abort/deletion/event awaits.
  const child = current?.child;
  const client = originalClient ?? current?.cleanupClient;
  if (current && !current.stop) {
    current.stop = Promise.resolve().then(async () => {
      const wire = async () => {
        const failures: unknown[] = [];
        for (const effect of [
          () => client!.abortSession(current.sessionId),
          () => client!.deleteSession(current.sessionId),
          () => client!.closeEvents(TEXT_CHILD_ID),
        ]) {
          try {
            await effect();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length)
          throw new ProviderRetirementError(
            "opencode.wire",
            failures,
            "Original OpenCode text cleanup failed",
          );
      };
      await settleProviderRetirements([wire(), ...(child ? [retirements.retire([child])] : [])]);
    });
    retainTextWireRetirement(current, current.stop);
  }
  if (live === current) live = null;
  if (current) current.closed = true;
  const stoppedSetup = setup ? stopSetup(setup) : Promise.resolve();
  const originalWire = expected
    ? current?.stop
      ? [current.stop]
      : []
    : [...snapshot.wire, ...(current?.stop ? [current.stop] : [])];
  await settleProviderRetirements([
    stoppedSetup,
    ...originalWire,
    ...(expected ? [] : [snapshot.cohort.retire()]),
  ]);
}

function pickTextModel(requested?: string): {
  providerID: string;
  modelID: string;
} {
  const selected = requested?.trim();
  if (selected) {
    const modelSlug = selected.startsWith("opencode:")
      ? selected.slice("opencode:".length)
      : selected;
    const parsedSelected = parseOpenCodeModelSlug(modelSlug);
    if (parsedSelected) return parsedSelected;
    if (modelSlug) return { providerID: "opencode", modelID: modelSlug };
  }
  const models = modelsFor("opencode");
  for (const model of models) {
    const parsed = parseOpenCodeModelSlug(model.nativeId ?? model.id);
    if (parsed) return parsed;
  }
  return { providerID: "opencode", modelID: "glm-5" };
}

function sameModel(
  left: { providerID: string; modelID: string },
  right: { providerID: string; modelID: string },
): boolean {
  return left.providerID === right.providerID && left.modelID === right.modelID;
}

function modelSettingsKey(settings?: Record<string, string>): string {
  return JSON.stringify({
    agent: settings?.agent,
    variant: settings?.variant,
  });
}

function openCodeTextAgent(
  intent: TurnIntent | undefined,
  settings?: Record<string, string>,
): string | undefined {
  if (intent === "plan") return "plan";
  if (intent === "build") return "build";
  const configured = settings?.agent?.trim();
  return configured || "build";
}

export function getOpenCodeTextResponse(parts: unknown[] | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      if (!("type" in part) || part.type !== "text") return [];
      if (!("text" in part) || typeof part.text !== "string") return [];
      return [part.text];
    })
    .join("")
    .trim();
}

function waitForUrl(read: () => string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const url = read();
      if (url) {
        resolve(url);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("Timed out waiting for OpenCode text server"));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
