import { captureTextInput, prepareTextProcess, runTextOperation } from "../../core/textSource";
import { captureByteTurnWriter } from "../turnWriter";
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
import {
  createChildProcessHandle,
  resolveClaudeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  type ChildProcessHandle,
} from "../../core/child";
import { isAgentToolName } from "../../core/preview";
import {
  assistantTextBlocks,
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  inputJsonDeltaFromEvent,
  isClaudeUltracodeEffort,
  normalizeClaudeCliEffort,
  parseJsonLine,
  previewFromTool,
  resolveClaudeApiModelId,
  streamDeltaFromEvent,
  stringField,
  summarizeToolRequest,
  toolKindFromName,
  toolStartFromEvent,
  toolTitle,
  tryParseJsonRecord,
  turnStatusFromResult,
  turnMetricsFromResult,
  usageFromResult,
} from "./claudeProtocol";
import type { TurnIntent } from "../../../../features/sessions/model/session";
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";
import type { TextPromptInput } from "../../core/registry";
import { mergeStream } from "../../core/streamText";
import { utilityOutputExceeded, validateTextOutputLimit } from "../../core/textOutput";
import type { ClaudeCliSettings } from "./claudeProtocol";

const retirements = createProviderRetirementLedger("claude.text", killChild);

const TEXT_CHILD_ID = "bycoda-claude-text";
const REQUEST_TIMEOUT_MS = 45_000;
const TEXT_MODEL = "claude-haiku-4-5";

type TextSettings = {
  advisor?: string;
  subagentModel?: string;
  subagentPolicy?: string;
  key: string;
  launchModel: string;
  effort?: string;
  promptEffort?: string;
  settings: ClaudeCliSettings;
  permissionMode?: "plan";
};

type InFlightTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  partialJson: string;
  title: string;
};

type LiveText = {
  child: ChildProcessHandle;
  cwd: string;
  providerAccountId?: string;
  model: string;
  settingsKey: string;
  persistent: boolean;
  threadId?: string;
  collecting: boolean;
  output: string;
  outputLimit?: number;
  reasoningChars?: number;
  closed: boolean;
  ready: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  readyDone: (() => void) | null;
  onEvent?: (event: HarnessEvent) => void;
  toolsByIndex: Map<number, InFlightTool>;
  toolsById: Map<string, InFlightTool>;
  compacting?: boolean;
  compactionConfirmed?: boolean;
};

let live: LiveText | null = null;
let pendingSetup: LiveText | null = null;
let turns: Promise<void> = Promise.resolve();

function textSettings(
  model: string,
  modelSettings?: Record<string, string>,
  intent?: TurnIntent,
  maxOutputTokens?: number,
): TextSettings {
  const effort = modelSettings?.effort?.trim() || undefined;
  const context = modelSettings?.context?.trim() || undefined;
  const thinking = modelSettings?.thinking === "true";
  const fast = modelSettings?.fast === "true";
  const readOnly = intent === "plan";
  const advisor = modelSettings?.advisor;
  const subagentModel = modelSettings?.subagentModel;
  const subagentPolicy = modelSettings?.subagentPolicy;
  const settings: ClaudeCliSettings = {};
  if (maxOutputTokens !== undefined)
    settings.env = { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens) };
  if (thinking) settings.alwaysThinkingEnabled = true;
  if (fast) settings.fastMode = true;
  if (isClaudeUltracodeEffort(effort)) settings.ultracode = true;
  return {
    key: JSON.stringify({
      effort,
      context,
      thinking,
      fast,
      readOnly,
      advisor,
      subagentModel,
      subagentPolicy,
      maxOutputTokens,
    }),
    advisor,
    subagentModel,
    subagentPolicy,
    launchModel: resolveClaudeApiModelId(model, context),
    effort: normalizeClaudeCliEffort(effort, model),
    promptEffort: effort,
    settings,
    ...(readOnly ? { permissionMode: "plan" as const } : {}),
  };
}

function pickTextModel(requested?: string): string {
  const selected = requested?.trim();
  if (selected) return selected;
  const models = modelsFor("claude");
  const haiku = models.find((model) =>
    /haiku/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return haiku?.nativeId ?? TEXT_MODEL;
}

export async function stopClaudeTextPrompt(): Promise<void> {
  await dropLive();
}

export function warmupClaudeText(
  cwd: string,
  options?: { providerAccountId?: string; model?: string; modelSettings?: Record<string, string> },
): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const run = continueAfterFailure(turns, async () => {
    if (!options) return void (await ensureLive(cwd));
    // Same model and settings as promptOnLive, so the next matching prompt reuses this process.
    const model = pickTextModel(options.model);
    await ensureLive(
      cwd,
      options.providerAccountId,
      model,
      textSettings(model, options.modelSettings),
    );
  });
  turns = settledTail(run);
  return observeProviderProbeCleanup(run);
}

export async function runClaudeTextPrompt(input: TextPromptInput): Promise<string> {
  input = captureTextInput(input);
  const run = turns
    .catch(() => undefined)
    .then(() => runTextOperation(input.operationContext, () => promptOnLive(input)));
  turns = settledTail(run);
  return run;
}

async function promptOnLive(input: TextPromptInput): Promise<string> {
  input.signal?.throwIfAborted();
  if (input.compactBefore && (input.ephemeral !== false || !input.threadId || !input.onCompacted))
    throw new Error("Claude compaction requires its exact persistent utility thread and receipt.");
  const model = pickTextModel(input.model);
  validateTextOutputLimit(input.maxOutputTokens);
  validateTextOutputLimit(input.maxOutputChars);
  const settings = textSettings(model, input.modelSettings, input.intent, input.maxOutputTokens);
  const session = await ensureLive(
    input.cwd,
    input.providerAccountId,
    model,
    settings,
    input.operationContext,
    input,
  );
  let write: Awaited<ReturnType<ReturnType<typeof captureByteTurnWriter>>>;
  try {
    prepareTextProcess(session.child, input.operationContext);
    write = await captureByteTurnWriter(
      session.child,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
    )();
    input.signal?.throwIfAborted();
  } catch (error) {
    return preserveProviderFailure(error, dropLive(session));
  }
  session.output = "";
  session.outputLimit = input.maxOutputChars;
  session.reasoningChars = 0;
  session.collecting = true;
  session.onEvent = input.onEvent;
  session.toolsByIndex = new Map();
  session.toolsById = new Map();
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const abortPromise = input.signal
    ? new Promise<never>((_, reject) => {
        const cancel = () => {
          session.turnFailed?.(new Error("By-the-way request cancelled"));
          reject(new Error("By-the-way request cancelled"));
        };
        abortHandler = cancel;
        input.signal!.addEventListener("abort", cancel, { once: true });
        if (input.signal!.aborted) cancel();
      })
    : null;

  return withProviderRetirement(
    async () => {
      if (input.compactBefore) {
        session.compacting = true;
        session.compactionConfirmed = false;
        const completed = new Promise<void>((resolve, reject) => {
          session.turnDone = resolve;
          session.turnFailed = reject;
        });
        completed.catch(() => undefined);
        const compact = async () => {
          await write(JSON.stringify(buildClaudeUserMessage({ text: "/compact" })));
          await completed;
        };
        await Promise.race([
          compact(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Claude text compaction timed out")),
              timeoutMs,
            );
          }),
          ...(abortPromise ? [abortPromise] : []),
        ]);
        clearTimeout(timeout);
        timeout = undefined;
        input.signal?.throwIfAborted();
        if (!session.compactionConfirmed || session.threadId !== input.threadId)
          throw new Error(
            "Claude Code did not confirm context compaction for the original Chief thread.",
          );
        await input.onCompacted!({ threadId: session.threadId! });
        input.signal?.throwIfAborted();
        session.compacting = false;
        session.output = "";
        session.reasoningChars = 0;
        session.toolsByIndex.clear();
        session.toolsById.clear();
      }
      const turnPromise = new Promise<void>((resolve, reject) => {
        session.turnDone = resolve;
        session.turnFailed = reject;
      });
      turnPromise.catch(() => undefined);

      await write(
        JSON.stringify(
          buildClaudeUserMessage({
            text: input.prompt,
            effort: settings.promptEffort,
          }),
        ),
      );

      await Promise.race([
        turnPromise,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Claude text generation timed out")),
            timeoutMs,
          );
        }),
        ...(abortPromise ? [abortPromise] : []),
      ]);

      const output = session.output.trim();
      if (!output) throw new Error("Claude returned empty output.");
      return output;
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

async function ensureLive(
  cwd: string,
  providerAccountId?: string,
  requestedModel?: string,
  requestedSettings?: TextSettings,
  operationContext?: HarnessOperationContext,
  context?: Pick<TextPromptInput, "ephemeral" | "threadId" | "onThreadId">,
): Promise<LiveText> {
  const model = pickTextModel(requestedModel);
  const settings = requestedSettings ?? textSettings(model);
  const current = live;
  if (current && !current.closed) {
    prepareTextProcess(current.child, operationContext);
    await captureByteTurnWriter(
      current.child,
      operationContext?.nativeControlTurn,
      operationContext,
    )();
    if (live !== current || current.closed) throw new Error("Claude text generator stopped");
  }
  if (
    current &&
    live === current &&
    !current.closed &&
    current.cwd === cwd &&
    current.providerAccountId === providerAccountId &&
    current.model === model &&
    current.settingsKey === settings.key &&
    current.persistent === (context?.ephemeral === false) &&
    (!context?.threadId || context.threadId === current.threadId)
  ) {
    if (current.threadId) await context?.onThreadId?.(current.threadId);
    return current;
  }
  return startLive(cwd, providerAccountId, model, settings, operationContext, context);
}

async function startLive(
  cwd: string,
  providerAccountId?: string,
  model = pickTextModel(),
  settings = textSettings(model),
  operationContext?: HarnessOperationContext,
  context?: Pick<TextPromptInput, "ephemeral" | "threadId" | "onThreadId">,
): Promise<LiveText> {
  const previous = captureDrop();
  const child = createChildProcessHandle(TEXT_CHILD_ID, operationContext?.nativeControlTurn);
  prepareTextProcess(child, operationContext, true);
  retirements.admitPending(child);
  const session: LiveText = {
    child,
    cwd,
    providerAccountId,
    model,
    settingsKey: settings.key,
    persistent: context?.ephemeral === false,
    ...(context?.ephemeral === false ? { threadId: context.threadId || crypto.randomUUID() } : {}),
    collecting: false,
    output: "",
    closed: false,
    ready: false,
    turnDone: null,
    turnFailed: null,
    readyDone: null,
    toolsByIndex: new Map(),
    toolsById: new Map(),
  };
  pendingSetup = session;
  const stopping = dropLive(undefined, previous);
  try {
    await stopping;
    if (session.closed || pendingSetup !== session)
      throw new Error("Claude text generator stopped");
    const { path } = await resolveClaudeBinary();
    if (session.closed || pendingSetup !== session)
      throw new Error("Claude text generator stopped");
    if (session.threadId) await context?.onThreadId?.(session.threadId);
    watchChild(
      session.child,
      (line) => handleLine(session, line),
      () => {
        session.closed = true;
        if (live === session) live = null;
        session.turnFailed?.(new Error("Claude text generator exited"));
        session.readyDone?.();
        session.turnDone = null;
        session.turnFailed = null;
        session.readyDone = null;
      },
    );
    await spawnChild(
      session.child,
      path,
      buildClaudeSpawnArgs({
        isolated: true,
        persistSession: session.persistent,
        ...(session.persistent
          ? context?.threadId
            ? { resume: context.threadId }
            : { sessionId: session.threadId }
          : {}),
        model: settings.launchModel,
        advisor: settings.advisor,
        subagentModel: settings.subagentModel,
        subagentPolicy: settings.subagentPolicy,
        effort: settings.effort,
        settings: settings.settings,
        permissionMode: settings.permissionMode,
      }),
      cwd,
      { provider: "claude", id: providerAccountId ?? "default" },
      "claude",
    );
    if (session.closed || pendingSetup !== session)
      throw new Error("Claude text generator stopped");
    await captureByteTurnWriter(child, operationContext?.nativeControlTurn, operationContext)();
    pendingSetup = null;
    live = session;
    // Do not wait for `init`: current CLIs emit it only after the first message,
    // and stream-json input is buffered until startup finishes. Waiting delayed
    // every cold prompt (and any prompt queued behind a warmup) by 8 s.
    return session;
  } catch (error) {
    return preserveProviderFailure(error, settleProviderRetirements([stopping, dropLive(session)]));
  }
}

function captureDrop() {
  return {
    targets: [
      ...new Set([live, pendingSetup].filter((entry): entry is LiveText => entry !== null)),
    ],
    cohort: retirements.cohort(TEXT_CHILD_ID),
  };
}
async function dropLive(
  expected?: LiveText,
  captured?: ReturnType<typeof captureDrop>,
): Promise<void> {
  const snapshot = captured ?? captureDrop();
  const targets = expected ? [expected] : snapshot.targets;
  for (const current of targets) {
    if (live === current) live = null;
    if (pendingSetup === current) pendingSetup = null;
    current.closed = true;
    current.readyDone?.();
    current.turnFailed?.(new Error("Claude text generator stopped"));
    current.turnDone = null;
    current.turnFailed = null;
    current.readyDone = null;
    unwatchChild(current.child);
  }
  await (expected
    ? retirements.retire(targets.map((current) => current.child))
    : settleProviderRetirements([
        snapshot.cohort.retire(),
        retirements.retire(targets.map((current) => current.child)),
      ]));
}

function handleLine(session: LiveText, line: string): void {
  const rec = parseJsonLine(line);
  if (!rec) return;
  const type = stringField(rec, "type");
  if (
    type === "system" &&
    (stringField(rec, "subtype") === "init" || stringField(rec, "subtype") === "initialized")
  ) {
    session.ready = true;
    session.readyDone?.();
    session.readyDone = null;
  }
  if (!session.collecting) return;
  if (
    session.compacting &&
    type === "system" &&
    stringField(rec, "subtype") === "compact_boundary"
  ) {
    if (stringField(rec, "session_id") === session.threadId) session.compactionConfirmed = true;
    return;
  }
  if (type === "assistant") {
    const snapshot = assistantTextBlocks(rec).join("");
    if (snapshot) {
      const output = mergeStream(session.output, snapshot);
      if (!acceptOutput(session, output, session.reasoningChars ?? 0)) return;
      session.output = output;
    }
    return;
  }
  if (type === "stream_event") {
    handleStreamEvent(session, rec);
    return;
  }
  if (type === "result") {
    if (session.compacting && stringField(rec, "session_id") !== session.threadId) {
      session.turnFailed?.(
        new Error("Claude compaction result does not identify its original thread."),
      );
      return;
    }
    const usage = usageFromResult(rec);
    if (usage) session.onEvent?.({ type: "usage", ...usage });
    const metrics = turnMetricsFromResult(rec);
    if (metrics) session.onEvent?.({ type: "turn.metrics", ...metrics });
    const result = turnStatusFromResult(rec);
    if (result.status === "failed" || (session.compacting && result.status !== "completed")) {
      session.turnFailed?.(new Error(result.error ?? "Claude turn failed"));
    } else {
      session.turnDone?.();
    }
    session.turnDone = null;
    session.turnFailed = null;
  }
}

function handleStreamEvent(session: LiveText, rec: Record<string, unknown>): void {
  const delta = streamDeltaFromEvent(rec);
  if (delta) {
    if (delta.kind === "assistant") {
      if (!acceptOutput(session, session.output + delta.text, session.reasoningChars ?? 0)) return;
      session.output += delta.text;
      session.onEvent?.({ type: "message.delta", text: delta.text });
    } else {
      const reasoningChars = (session.reasoningChars ?? 0) + delta.text.length;
      if (!acceptOutput(session, session.output, reasoningChars)) return;
      session.reasoningChars = reasoningChars;
      session.onEvent?.({ type: "reasoning.delta", text: delta.text });
    }
    return;
  }

  const started = toolStartFromEvent(rec);
  if (started) {
    const tool: InFlightTool = {
      id: started.id,
      name: started.name,
      input: started.input,
      partialJson: "",
      title: toolTitle(started.name, started.input),
    };
    if (started.index >= 0) session.toolsByIndex.set(started.index, tool);
    session.toolsById.set(started.id, tool);
    session.onEvent?.({
      type: "tool.started",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      ...(isAgentToolName(tool.name) && stringField(tool.input, "model")
        ? { agentModel: stringField(tool.input, "model") }
        : {}),
      status: isAgentToolName(tool.name) ? "in_progress" : "pending",
      preview: previewFromTool(tool.name, tool.input),
    });
    return;
  }

  const jsonDelta = inputJsonDeltaFromEvent(rec);
  if (!jsonDelta) return;
  const tool = session.toolsByIndex.get(jsonDelta.index);
  if (!tool) return;
  tool.partialJson += jsonDelta.partial;
  const parsed = tryParseJsonRecord(tool.partialJson);
  if (!parsed) return;
  tool.input = parsed;
  tool.title = toolTitle(tool.name, parsed);
  session.onEvent?.({
    type: "tool.updated",
    callId: tool.id,
    title: tool.title,
    kind: toolKindFromName(tool.name),
    ...(isAgentToolName(tool.name) && stringField(tool.input, "model")
      ? { agentModel: stringField(tool.input, "model") }
      : {}),
    status: "pending",
    detail: summarizeToolRequest(tool.name, parsed),
    preview: previewFromTool(tool.name, parsed),
  });
}

function acceptOutput(session: LiveText, output: string, reasoningChars: number): boolean {
  if (!utilityOutputExceeded(output, reasoningChars, session.outputLimit)) return true;
  session.collecting = false;
  session.turnFailed?.(
    new Error(
      "The utility response exceeded its local text allowance; provider usage is uncertain.",
    ),
  );
  return false;
}
