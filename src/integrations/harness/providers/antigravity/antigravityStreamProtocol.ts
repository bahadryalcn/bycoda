/*
 * Antigravity over `agy -p= --input-format stream-json --output-format stream-json`.
 *
 * Windows has no ACP server (`agy_acp_server.par` is a POSIX archive), but agy
 * 1.2.14's headless mode is a usable transport. Everything below was observed
 * by running agy.exe in a scratch directory (19 probe runs) and by reading the
 * strings in the binary; nothing here is documented by Google.
 *
 * PROCESS MODEL
 *   One process serves a whole conversation. `-p=` (empty prompt) is required:
 *   a bare `-p` swallows the next flag as its prompt. stdin takes one NDJSON
 *   message per line and every message runs one turn, in order. EOF on stdin
 *   lets the running turn finish and then exits 0. A killed process leaves the
 *   conversation resumable with `--conversation <id>`.
 *
 * STDIN (the only message that does anything is "user")
 *   {"event":"user","message":{"role":"user","content":"hello"}}
 *   `content` is a string or a list of blocks, and the binary only accepts
 *   text blocks ("content block type %q is not supported (only %q)"), so there
 *   is no way to send an image. Unknown events are ignored with a warning on
 *   stderr ({"event":"zzz"}); a missing "event" ends the run with a result
 *   ERROR. There is no cancel or permission-reply message.
 *
 * STDOUT (NDJSON)
 *   init, once per process, before any turn:
 *   {"event":"init","conversation_id":"7500e8a2-…","init":{"model":"gemini-3.8-flash","cwd":"C:\\…","tools":["ask_permission","run_command","view_file",…],"permission_mode":"request-review"}}
 *     `model` is present only when --model was passed. permission_mode reads
 *     "always-proceed" under --dangerously-skip-permissions and
 *     "request-review" otherwise, even with --mode plan / accept-edits.
 *   step_update, one per step transition (step_index counts the whole
 *   conversation, so it keeps growing across turns and across resumes):
 *   {"event":"step_update","step_update":{"conversation_id":"…","step_index":0,"state":"DONE","step_type":"user_input"}}
 *   {"event":"step_update","step_update":{"conversation_id":"…","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"BANANA"}}
 *   {"event":"step_update","step_update":{"conversation_id":"…","step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"\n","duration_seconds":28.28,"usage":{"input_tokens":12403,"output_tokens":119,"thinking_tokens":117,"cache_read_tokens":0,"total_tokens":12522}}}
 *     text_delta is always a delta (never a snapshot) and may ride on DONE.
 *     A model call that only thought has no text_delta; thinking text is never
 *     sent, only thinking_tokens. `usage` is that single model call, so its
 *     input_tokens is the context size at that call.
 *   {"event":"step_update","step_update":{"conversation_id":"…","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"write_to_file","tool_info":{"name":"write_to_file","parameters":{"TargetFile":"C:\\…\\hello.txt"}}}}
 *   {"event":"step_update","step_update":{"conversation_id":"…","step_index":8,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":1.31,"tool_info":{"name":"run_command","parameters":{"CommandLine":"echo done"},"output":"done\r\n"}}}
 *   {"event":"step_update","step_update":{"conversation_id":"…","step_index":4,"state":"ERROR","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"},"error":{"type":"TOOL_ERROR","message":"permission check failed for command \"echo hi\": user denied permission to run command:\necho hi\n…"}}}}
 *     Parameter names are PascalCase (CommandLine, TargetFile, AbsolutePath).
 *     write_to_file / replace_file_content carry only the target path: no
 *     content and no diff. view_file and run_command carry `output` on DONE;
 *     run_command has no exit code. Tools seen: write_to_file, view_file,
 *     replace_file_content, run_command. The default agent no longer uses
 *     grep_search / list_dir / find_by_name (they are only in custom agents),
 *     so those are mapped from the tool list, not from a capture.
 *     Tool steps for a call arrive ACTIVE then DONE|ERROR, usually in the same
 *     millisecond for a fast tool.
 *   {"event":"step_update","step_update":{"conversation_id":"…","step_index":2,"state":"DONE","step_type":"subagent","tool_name":"invoke_subagent","subagent_info":{"subagents":[{"type_name":"self","role":"Greeter","initial_prompt":"Reply with the single word hello.","conversation_id":"32ed0956-…"}]}}}
 *     A subagent's own steps are not streamed; only this one step.
 *   Other step_types seen and ignored: "system_message" (appears on resume and
 *   after plan-mode approval) and "unknown" (an ask_question the headless run
 *   auto-skipped: the agent is told the user skipped it).
 *   result, once per turn:
 *   {"event":"result","result":{"conversation_id":"…","status":"SUCCESS","response":"BANANA\n","duration_seconds":30.88,"num_turns":2,"usage":{"input_tokens":24634,"output_tokens":210,"thinking_tokens":207,"cache_read_tokens":0,"total_tokens":24844},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}
 *     result.usage, num_turns and duration_seconds are cumulative over the
 *     conversation (a resumed one too), so per-turn numbers are summed from the
 *     step usages instead. `denied_actions` lists what headless mode refused.
 *   A run that cannot start still prints a result:
 *   {"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \"x\" --effort \"\"): …","num_turns":0,"usage":{…}}}
 *     and exits 1; the same text goes to stderr. Failures only seen this way:
 *     bad --model / --effort, a 503 eligibility check, a missing "event".
 *
 * PERMISSIONS (the part that does not map onto Bycoda's modes)
 *   There is no approval round trip. Headless agy cannot ask, so:
 *   - file tools (write_to_file, replace_file_content) are applied at once in
 *     every mode: default, --mode accept-edits and --mode plan all wrote the
 *     file. (--mode plan also writes an implementation_plan.md under
 *     ~/.gemini/antigravity-cli/brain, then auto-continues and edits anyway.)
 *   - run_command is auto-denied (tool ERROR, `denied_actions`, and a stderr
 *     note) unless --dangerously-skip-permissions is set.
 *   - --mode accept-edits changed nothing observable; --mode plan is not a
 *     read-only mode. Neither is passed.
 *   - --dangerously-skip-permissions auto-approves everything.
 *   Consequently "supervised" (ask before edits) and plan turns (no edits)
 *   cannot be honoured and are refused instead of running more permissively.
 *
 * MODELS AND EFFORT
 *   `agy models` prints "Fetching available models..." then `id<TAB>name`.
 *   The -high/-medium/-low suffix in an id already is the effort. --effort
 *   conflicts with those ids ("--model gemini-3.8-flash-high conflicts with
 *   --effort=low"), is unsupported for claude-sonnet-4-6, and is accepted only
 *   with a bare family id such as gemini-3.8-flash, which `agy models` does not
 *   list. Bycoda therefore passes --model <listed id> and never --effort.
 *
 * COULD NOT DETERMINE
 *   Result statuses other than SUCCESS and ERROR; whether agy can emit
 *   reasoning text; context window sizes; behaviour of a mid-tool kill (the
 *   interrupted turn leaves no partial assistant text in the resumed
 *   conversation); whether `--disable-slash-commands` also hides skills from
 *   the model (without it a "/x" prompt is refused in stream-json mode).
 */
import { promptText } from "../../../../features/sessions/model/attachments";
import type { AgentModel } from "../../../../features/sessions/model/models";
import type {
  Attachment,
  HarnessModeLimits,
  RuntimeMode,
  ToolPreview,
  TurnIntent,
  TurnMetrics,
} from "../../../../features/sessions/model/session";
import { agentToolTitle, extractToolPreview, titleFromToolInput } from "../../core/preview";
import type { HarnessEvent } from "../../core/types";

/** Longest tool output forwarded to the transcript. */
const MAX_TOOL_DETAIL = 50_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Launch

/**
 * Headless agy cannot ask before editing and cannot hold edits back, so the
 * modes that promise either are refused rather than run more permissively.
 */
export function streamModeRefusal(
  runtimeMode: RuntimeMode,
  intent?: TurnIntent,
): string | undefined {
  if (intent === "plan") {
    return "Plan mode is not available for Antigravity on Windows: headless agy cannot keep a plan turn from editing files.";
  }
  if (runtimeMode === "supervised") {
    return "Supervised mode is not available for Antigravity on Windows: headless agy cannot ask before editing files, so it would apply edits unasked. Switch to Auto-accept edits (edits apply, commands are denied) or Full access.";
  }
  return undefined;
}

/**
 * What the pickers say about the same limits `streamModeRefusal` enforces.
 * Supervised is unavailable, and a new session starts in Auto-accept edits,
 * which is exactly what headless agy does for every non-full-access mode.
 */
export const STREAM_MODE_LIMITS: HarnessModeLimits = {
  runtimeModes: {
    supervised: "Headless agy cannot ask before editing files.",
  },
  plan: "Headless agy cannot keep a plan turn from editing files.",
  newSessionMode: "auto-accept-edits",
};

export type StreamLaunch = {
  model?: string;
  /** Conversation to resume. */
  conversationId?: string;
  addDirs?: readonly string[];
  runtimeMode: RuntimeMode;
};

/**
 * Only full access changes what headless agy allows; every other supported
 * mode runs in its default (edits applied, commands denied), which is as
 * restrictive as agy gets.
 */
export function antigravityStreamArgs(launch: StreamLaunch): string[] {
  const args = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--print=",
    "--disable-slash-commands",
  ];
  if (launch.model) args.push("--model", launch.model);
  if (launch.conversationId) args.push("--conversation", launch.conversationId);
  for (const dir of launch.addDirs ?? []) args.push("--add-dir", dir);
  if (launch.runtimeMode === "full-access") {
    args.push("--dangerously-skip-permissions");
  }
  return args;
}

/** One stdin line that starts a turn, or undefined for an empty prompt. */
export function antigravityStreamUserLine(
  text: string,
  attachments: Attachment[] = [],
): string | undefined {
  // No image blocks exist on this transport, so attachments travel as the same
  // path legend the other text-only harnesses get.
  const content = promptText(text, attachments);
  if (!content) return undefined;
  return JSON.stringify({
    event: "user",
    message: { role: "user", content },
  });
}

// ---------------------------------------------------------------------------
// Models

/** `agy models`: a "Fetching…" line, then `id<TAB>Display Name` rows. */
export function parseAntigravityModels(stdout: string): AgentModel[] {
  const models = new Map<string, AgentModel>();
  for (const raw of stdout.split(/\r?\n/)) {
    const [id, ...rest] = raw.split("\t");
    const nativeId = id?.trim();
    // Only a tab separates the columns; the progress line has none.
    if (!nativeId || rest.length === 0 || /\s/.test(nativeId)) continue;
    if (models.has(nativeId)) continue;
    const name = rest.join("\t").trim() || nativeId;
    models.set(nativeId, {
      id: `antigravity:${nativeId}`,
      harness: "antigravity",
      name,
      nativeId,
    });
  }
  return [...models.values()];
}

// ---------------------------------------------------------------------------
// Events

export type StreamState = {
  conversationId?: string;
  /** Steps whose tool.started has been sent, by step_index. */
  tools: Map<number, { title: string; kind: string }>;
  /** agent_response steps that streamed text, by step_index. */
  messages: Set<number>;
  /** Summed over this turn's model calls. */
  metrics: TurnMetrics;
  denied: string[];
};

export function createStreamState(): StreamState {
  return { tools: new Map(), messages: new Set(), metrics: {}, denied: [] };
}

/** Forget what belongs to the previous turn. */
export function beginStreamTurn(state: StreamState): void {
  state.tools.clear();
  state.messages.clear();
  state.metrics = {};
  state.denied = [];
}

export type StreamOutcome = {
  events: HarnessEvent[];
  /** `init` arrived: the process is ready and the id is known. */
  initialized?: boolean;
  /** agy recorded the user message, so the conversation exists to resume. */
  userAccepted?: boolean;
  /** The turn ended, successfully or not. */
  result?: { ok: boolean; error?: string };
};

const NO_OUTCOME: StreamOutcome = { events: [] };

export function toolKindFromAgyName(name: string): string {
  switch (name) {
    case "run_command":
    case "send_command_input":
      return "execute";
    case "view_file":
    case "view_file_outline":
    case "view_code_item":
    case "list_dir":
      return "read";
    case "write_to_file":
    case "replace_file_content":
    case "multi_replace_file_content":
      return "edit";
    case "grep_search":
    case "find_by_name":
    case "search_web":
      return "search";
    case "invoke_subagent":
      return "agent";
    default:
      return name;
  }
}

/** agy's PascalCase parameters, renamed to the keys the shared preview reads. */
function normalizeParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parameters };
  const alias: Record<string, string> = {
    CommandLine: "command",
    TargetFile: "file_path",
    AbsolutePath: "file_path",
    DirectoryPath: "path",
    SearchPath: "path",
    SearchDirectory: "path",
    Query: "query",
    Pattern: "pattern",
    Url: "url",
  };
  for (const [from, to] of Object.entries(alias)) {
    if (out[from] !== undefined && out[to] === undefined) out[to] = out[from];
  }
  return out;
}

type ToolView = {
  title: string;
  kind: string;
  preview?: ToolPreview;
};

function toolView(name: string, parameters: Record<string, unknown>): ToolView {
  const kind = toolKindFromAgyName(name);
  const input = normalizeParameters(parameters);
  if (name === "list_dir") {
    const path = str(input.path);
    return { title: path ? `List ${path}` : "List directory", kind };
  }
  const preview = extractToolPreview(
    { title: name, name, kind, rawInput: input, input },
    { title: name, name, kind, rawInput: input },
  );
  // The shared builder leaves edit rows with the bare tool name.
  const verb = name === "write_to_file" ? "Write" : kind === "edit" ? "Edit" : "";
  const title =
    verb && preview?.path ? `${verb} ${preview.path}` : titleFromToolInput(name, kind, input);
  return { title, kind, ...(preview ? { preview } : {}) };
}

function subagentView(info: unknown): ToolView {
  const first = asRecord(
    Array.isArray(asRecord(info)?.subagents)
      ? (asRecord(info)?.subagents as unknown[])[0]
      : undefined,
  );
  const label = str(first?.role) ?? str(first?.initial_prompt);
  return {
    title: agentToolTitle({ description: label?.slice(0, 80) }),
    kind: "agent",
  };
}

function cap(text: string): string {
  return text.length > MAX_TOOL_DETAIL
    ? `${text.slice(0, MAX_TOOL_DETAIL)}\n… (output truncated)`
    : text;
}

function addUsage(state: StreamState, usage: Record<string, unknown>): number {
  const input = num(usage.input_tokens) ?? 0;
  const output = num(usage.output_tokens) ?? 0;
  const cache = num(usage.cache_read_tokens) ?? 0;
  const m = state.metrics;
  m.inputTokens = (m.inputTokens ?? 0) + input;
  m.outputTokens = (m.outputTokens ?? 0) + output;
  if (cache > 0) m.cacheReadTokens = (m.cacheReadTokens ?? 0) + cache;
  return num(usage.total_tokens) ?? input + output;
}

function stepEvents(state: StreamState, step: Record<string, unknown>): StreamOutcome {
  const index = num(step.step_index);
  const type = str(step.step_type);
  const stepState = str(step.state);
  if (index == null || !type || !stepState) return NO_OUTCOME;
  const events: HarnessEvent[] = [];

  if (type === "user_input") {
    return stepState === "DONE" ? { events, userAccepted: true } : NO_OUTCOME;
  }

  if (type === "agent_response") {
    const text = str(step.text_delta);
    if (text) {
      state.messages.add(index);
      events.push({ type: "message.delta", text });
    }
    if (stepState !== "ACTIVE") {
      if (state.messages.delete(index)) events.push({ type: "message.completed" });
      const usage = asRecord(step.usage);
      if (usage) {
        const used = addUsage(state, usage);
        if (used > 0) events.push({ type: "context", used });
      }
    }
    return { events };
  }

  if (type !== "tool" && type !== "subagent") return NO_OUTCOME;

  const name = str(step.tool_name) ?? str(asRecord(step.tool_info)?.name) ?? type;
  const info = asRecord(step.tool_info);
  const view =
    type === "subagent"
      ? subagentView(step.subagent_info)
      : toolView(name, asRecord(info?.parameters) ?? {});
  const callId = `${state.conversationId ?? "agy"}:${index}`;

  if (!state.tools.has(index)) {
    state.tools.set(index, { title: view.title, kind: view.kind });
    events.push({
      type: "tool.started",
      callId,
      title: view.title,
      kind: view.kind,
      status: "in_progress",
      ...(view.preview ? { preview: view.preview } : {}),
    });
  }
  if (stepState === "ACTIVE") return { events };

  const error = asRecord(info?.error);
  const failed = stepState !== "DONE";
  const output = str(info?.output);
  const detail = failed ? (str(error?.message) ?? `${view.title} failed.`) : output;
  events.push({
    type: "tool.updated",
    callId,
    title: view.title,
    kind: view.kind,
    status: failed ? "failed" : "completed",
    ...(detail ? { detail: cap(detail) } : {}),
    ...(view.preview ? { preview: view.preview } : {}),
  });
  return { events };
}

function deniedSummary(state: StreamState): string | undefined {
  if (state.denied.length === 0) return undefined;
  const what = [...new Set(state.denied)].join(", ");
  return `Antigravity denied ${what} because headless agy cannot ask for permission. Switch to Full access to allow it.`;
}

/**
 * Turn one stdout line into events. Anything that is not a recognisable
 * event, including malformed JSON, is dropped without touching the turn.
 */
export function handleStreamLine(state: StreamState, line: string): StreamOutcome {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return NO_OUTCOME;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return NO_OUTCOME;
  }
  const rec = asRecord(parsed);
  switch (str(rec?.event)) {
    case "init": {
      state.conversationId = str(rec?.conversation_id) ?? state.conversationId;
      return { events: [], initialized: true };
    }
    case "step_update": {
      const step = asRecord(rec?.step_update);
      if (!step) return NO_OUTCOME;
      state.conversationId = str(step.conversation_id) ?? state.conversationId;
      return stepEvents(state, step);
    }
    case "result": {
      const result = asRecord(rec?.result);
      if (!result) return NO_OUTCOME;
      const denied = Array.isArray(result.denied_actions) ? result.denied_actions : [];
      for (const item of denied) {
        const label = str(asRecord(item)?.display_name) ?? str(asRecord(item)?.action);
        if (label) state.denied.push(label);
      }
      const events: HarnessEvent[] = [];
      const metrics = state.metrics;
      if (metrics.inputTokens != null || metrics.outputTokens != null) {
        events.push({ type: "turn.metrics", ...metrics });
      }
      const note = deniedSummary(state);
      if (note) events.push({ type: "status", text: note });
      const status = str(result.status) ?? "ERROR";
      if (status === "SUCCESS") return { events, result: { ok: true } };
      const error = str(result.error) ?? `Antigravity ended the turn (${status}).`;
      return { events, result: { ok: false, error } };
    }
    default:
      return NO_OUTCOME;
  }
}
