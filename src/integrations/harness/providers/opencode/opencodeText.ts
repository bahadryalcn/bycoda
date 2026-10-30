import { continueAfterFailure, settledTail } from "../../../../shared/lib/promiseQueue";
import { modelsFor } from "../../../../features/sessions/model/models";
import type { TurnIntent } from "../../../../features/sessions/model/session";
import {
  createChildProcessHandle,
  execChild,
  freeHarnessPort,
  killChild,
  resolveOpenCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  type ChildProcessHandle,
} from "../../core/child";
import { OpenCodeClient } from "./opencodeClient";
import { abortTextPromptRace } from "../../core/abortTextPrompt";
import { streamTextDelta } from "../../core/streamText";
import type { HarnessEvent } from "../../core/types";
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

const TEXT_CHILD_ID = "bycoda-opencode-text";
const SERVER_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 45_000;

type LiveText = {
  child?: ChildProcessHandle;
  closed: boolean;
  stop?: Promise<void>;
  client: OpenCodeClient;
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
type TextSetup = { child?: ChildProcessHandle; cancelled: boolean; serverUrl: string };
let pendingSetup: TextSetup | null = null;
let stopGeneration = 0;
let turns: Promise<void> = Promise.resolve();

export async function stopOpenCodeTextPrompt(): Promise<void> {
  stopGeneration += 1;
  await dropLive();
}

export function warmupOpenCodeText(cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const run = continueAfterFailure(turns, async () => {
    await ensureLive(cwd);
  });
  turns = settledTail(run);
  return run.catch(() => undefined);
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
}): Promise<string> {
  const run = turns.catch(() => undefined).then(() => promptOnLive(input));
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
}): Promise<string> {
  input.signal?.throwIfAborted();
  const session = await ensureLive(input.cwd, input.model, input.modelSettings);
  input.signal?.throwIfAborted();
  session.onEvent = input.onEvent;
  const abort = abortTextPromptRace(input.signal, () =>
    session.client.abortSession(session.sessionId),
  );
  try {
    const result = await Promise.race([
      session.client.prompt({
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
  } finally {
    abort.detach();
    session.onEvent = undefined;
    await dropLive(session);
  }
}

async function ensureLive(
  cwd: string,
  requestedModel?: string,
  modelSettings?: Record<string, string>,
): Promise<LiveText> {
  const model = pickTextModel(requestedModel);
  const settingsKey = modelSettingsKey(modelSettings);
  if (
    live &&
    !live.closed &&
    live.cwd === cwd &&
    sameModel(live.model, model) &&
    live.modelSettingsKey === settingsKey
  )
    return live;
  const generation = stopGeneration;
  if (live) await dropLive();
  if (stopGeneration !== generation) throw new Error("OpenCode text generator stopped");
  return startLive(cwd, model, modelSettings);
}

async function startLive(
  cwd: string,
  model: { providerID: string; modelID: string },
  modelSettings?: Record<string, string>,
): Promise<LiveText> {
  const setup: TextSetup = { cancelled: false, serverUrl: "" };
  pendingSetup = setup;
  let session: LiveText | undefined;
  let createdSession: { client: OpenCodeClient; id: string } | undefined;
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
    const service = generation === "v2" ? await resolveOpenCodeV2Service(path, cwd) : undefined;
    assertCurrent();
    setup.serverUrl = service?.url ?? "";
    // A v2 service is external to this text request; only v1 constructs a child.
    if (generation === "v1") {
      const child = createChildProcessHandle(TEXT_CHILD_ID);
      setup.child = child;
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
    const client = new OpenCodeClient(url, cwd, generation, service?.password, TEXT_CHILD_ID);
    const created = await client.createSession({
      permission: [{ permission: "*", pattern: "*", action: "deny" }],
    });
    createdSession = { client, id: created.id };
    assertCurrent();
    const current: LiveText = {
      child: setup.child,
      closed: false,
      client,
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
    pendingSetup = null;
    live = current;
    await client.subscribeEvents(
      TEXT_CHILD_ID,
      (event) => handleTextEvent(current, event),
      () => undefined,
    );
    assertCurrent();
    return current;
  } catch (error) {
    if (session) await dropLive(session);
    else {
      try {
        if (createdSession) {
          await createdSession.client.abortSession(createdSession.id);
          await createdSession.client.deleteSession(createdSession.id);
        }
      } finally {
        await stopSetup(setup);
      }
    }
    throw error;
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

async function stopSetup(setup: TextSetup): Promise<void> {
  setup.cancelled = true;
  if (pendingSetup === setup) pendingSetup = null;
  if (setup.child) {
    unwatchChild(setup.child);
    await killChild(setup.child).catch(() => undefined);
  }
}

async function dropLive(expected?: LiveText): Promise<void> {
  const current = expected ?? live;
  const setup = expected ? null : pendingSetup;
  // Capture physical ownership before any provider abort/deletion/event awaits.
  const child = current?.child;
  if (live === current) live = null;
  if (current) current.closed = true;
  const stoppedSetup = setup ? stopSetup(setup) : Promise.resolve();
  if (!current) {
    await stoppedSetup;
    return;
  }
  // A Stop and this original prompt's finally share the same cleanup lifetime.
  current.stop ??= Promise.resolve().then(async () => {
    try {
      await current.client.abortSession(current.sessionId);
      await current.client.deleteSession(current.sessionId);
      await current.client.closeEvents(TEXT_CHILD_ID);
    } finally {
      if (child) {
        unwatchChild(child);
        await killChild(child).catch(() => undefined);
      }
    }
  });
  await Promise.all([current.stop, stoppedSetup]);
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
