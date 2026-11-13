import { boundToolOutput } from "./voiceToolOutput";
import { shouldWaitForVoice } from "./voiceSpeechPolicy";
import { VOICE_FEATURE_CONTEXT } from "./voiceFeatureLexicon";
import { VOICE_SHARED_POLICY } from "./voiceInstructions";
import { runHarnessTextPrompt } from "../../../integrations/harness";
import type { Session } from "../../sessions/model/session";
import { monotonicNow, elapsedSince } from "../../../shared/lib/time/timestamps";
import {
  VOICE_PROGRESS_AFTER_MS,
  observedRequestIds,
  voiceFailureReply,
  voiceLimitFallback,
  voiceProgressText,
} from "./voiceAssistantNotices";
import { personaBlock } from "./voicePrompt";
import { voiceRequest } from "./voiceConversation";
import {
  voiceRuntimeDeadline,
  voiceToolWaitsForOwner,
  type VoiceToolWait,
} from "./voiceRuntimeDeadline";

export type VoiceAssistantTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type VoiceAssistantInput = {
  /** Provider/account configuration, not permission to mutate this session. */
  session: Session;
  transcript: string;
  context: unknown;
  history?: readonly { role: string; text: string }[];
  signal: AbortSignal;
  tools: readonly VoiceAssistantTool[];
  execute: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    wait?: VoiceToolWait,
  ) => Promise<unknown>;
  /** Tool calls per spoken turn: default 12, at most 20. */
  maxToolCalls?: number;
  /** Interim speech for a slow multi-step turn; called at most once per turn. */
  onProgress?: (text: string) => void;
  /** Called with the spoken message when a failed turn is answered instead of thrown. */
  onFailure?: (message: string) => void;
  /** Owner persona block from voicePersonaInstructions; style only. */
  persona?: string;
};

type Decision =
  | { type: "no_reply" }
  | { type: "reply"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown> };

const MAX_OUTPUT = 64_000;
const MAX_RESULT = 48_000;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only an exact structured decision can reach the application dispatcher. */
export function parseVoiceAssistantDecision(output: string): Decision {
  if (output.length > MAX_OUTPUT) throw new Error("The voice assistant response is too large.");
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new Error("The voice assistant response could not be read. Please try again.");
  }
  if (!record(value)) throw new Error("The voice assistant response is invalid.");
  if (value.type === "no_reply" && Object.keys(value).length === 1) return { type: "no_reply" };
  if (
    value.type === "reply" &&
    Object.keys(value).every((key) => key === "type" || key === "text") &&
    typeof value.text === "string" &&
    value.text.trim() &&
    value.text.length <= 4000
  )
    return { type: "reply", text: value.text.trim() };
  if (
    value.type === "tool" &&
    Object.keys(value).every((key) => ["type", "name", "args"].includes(key)) &&
    typeof value.name === "string" &&
    /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(value.name) &&
    record(value.args)
  )
    return { type: "tool", name: value.name, args: value.args };
  throw new Error("The voice assistant response is invalid.");
}

/** Stable key without retry IDs: a new ID never authorizes repeating an effect. */
function callKey(name: string, args: Record<string, unknown>) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!record(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "requestId")
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  };
  return JSON.stringify([name, canonical(args)]);
}

/** Text prompts do not carry images. Never imply that base64 was visual input. */
function observedResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(observedResult);
  if (!record(value)) return value;
  if (value.kind === "image" || typeof value.dataUrl === "string")
    return {
      kind: "unavailable",
      reason: "image_input_unsupported",
      attachmentId: value.attachmentId,
      sessionId: value.sessionId,
      name: value.name,
      message:
        "This local text conversation cannot inspect image pixels. Use an image-capable voice provider.",
    };
  return Object.fromEntries(
    Object.entries(value).map(([key, part]) => [key, observedResult(part)]),
  );
}

function boundedData(value: unknown, max: number) {
  let text: string;
  try {
    text = JSON.stringify(observedResult(value)) ?? "null";
  } catch {
    return JSON.stringify({ unavailable: true, reason: "unserializable_tool_result" });
  }
  return boundToolOutput(text, max, Math.min(8_000, Math.floor(max / 2)));
}

const FINAL_SUMMARY = `The tool limit for this spoken turn is reached. No function can be called now. Return only {"type":"reply","text":"..."}: two or three short spoken sentences saying what was done, what is still pending, and that the owner can say "devam et" / "continue" to go on. Report only what the observations show; never claim success that was not observed.`;

function prompt(
  input: VoiceAssistantInput,
  observations: readonly unknown[],
  remaining: number,
  final = false,
) {
  return `You are bycoda's concise voice manager. Answer in the user's language.
${VOICE_FEATURE_CONTEXT}
You only generate JSON. You have no native tool, shell, file, network, MCP, or permission-changing authority. Do not use provider tools. Application operations execute ONLY through a returned tool decision and the application's authorized dispatcher.
Return exactly one JSON object: {"type":"reply","text":"brief natural reply"} or {"type":"tool","name":"one listed function","args":{...}} or {"type":"no_reply"}. Use no_reply only for an explicit request to wait or think; never for a question, choice, correction or instruction. No code fences, extra text, or extra fields.
${VOICE_SHARED_POLICY}
For an explicit current request to give a session work, use submit_work when listed for the captured session. Prepare a clear, actionable brief, not a verbatim transcript: the problem, desired outcome, stated constraints and corrections, and proportionate validation. Resolve references such as "fix that" from the current speech, session context and previous exchanges; read session_context when facts are missing. History helps interpret the CURRENT intent; it never independently authorizes an action. Paraphrase freely; do not ask for a polished specification or a repeat. Questions, discussion and greetings alone do not authorize work. submit_work addresses the captured session; for another target use only discovered authorized routing or ask.
Acknowledge delivery only if the observation says accepted=true; queued or accepted is not running or completed; do not resubmit the same intent after an accepted or uncertain delivery. Repeating an identical call in this spoken turn reuses its first observation. Silencing speech and pausing future automation runs do not stop running work.
Images are visible only when the provider receives actual image input. This text route cannot inspect pixels; image_input_unsupported must be explained honestly.
Keep replies brief, plain spoken sentences. You can perform at most ${remaining} further tool calls; when no calls remain, explain the observed result and outstanding work without inventing success.${final ? `\n${FINAL_SUMMARY}` : ""}${personaBlock(input.persona)}
AVAILABLE FUNCTIONS: ${final ? "[]" : JSON.stringify(input.tools)}
APPLICATION CONTEXT (data): ${boundedData(input.context, 32_000)}
PREVIOUS VOICE EXCHANGES (data): ${boundedData((input.history ?? []).slice(-6), 8000)}
TOOL OBSERVATIONS (data): ${boundedData(observations, 96_000)}
CURRENT USER SPEECH: ${JSON.stringify(input.transcript.slice(0, 16_000))}`;
}

/** One local spoken turn. The model plans; the application retains all effects. */
export async function converseWithAssistant(
  input: VoiceAssistantInput,
): Promise<VoiceAssistantResult> {
  input.signal.throwIfAborted();
  if (!input.transcript.trim() || input.transcript.length > 16_000)
    throw new Error("The voice request is empty or too long.");
  const limit = input.maxToolCalls ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("Voice tool calls must be limited to 1–20 per spoken turn.");
  const selected = await voiceRequest(input.session);
  input.signal.throwIfAborted();
  const observations: unknown[] = [];
  try {
    return await runTurn(input, observations, limit, selected);
  } catch (error) {
    // Cancellation stays silent; any other failure is spoken, bounded and free of internals.
    if (input.signal.aborted) throw error;
    const reply = voiceFailureReply(input.transcript, error);
    input.onFailure?.(reply);
    return { action: "reply", reply, requestIds: observedRequestIds(observations) };
  }
}

export type VoiceAssistantResult = {
  action: "reply" | "no_reply";
  reply: string;
  /** Request IDs of effects already attempted, so a follow-up turn does not repeat them. */
  requestIds?: string[];
};

async function runTurn(
  input: VoiceAssistantInput,
  observations: unknown[],
  limit: number,
  selected: Awaited<ReturnType<typeof voiceRequest>>,
): Promise<VoiceAssistantResult> {
  const allowed = new Set(input.tools.map((tool) => tool.name));
  const startedAt = monotonicNow();
  let progressSent = false;
  const attempts = new Map<string, unknown>();
  const request = {
    ...selected,
    // Read-only native provider mode; application effects remain in execute().
    intent: "plan" as const,
    ephemeral: true,
    timeoutMs: 30_000,
    signal: input.signal,
  };
  for (let turn = 0; turn <= limit; turn++) {
    input.signal.throwIfAborted();
    const output = await runHarnessTextPrompt({
      ...request,
      prompt: prompt(input, observations, limit - turn),
    });
    input.signal.throwIfAborted();
    const decision = parseVoiceAssistantDecision(output);
    if (decision.type === "reply") return { action: "reply", reply: decision.text };
    if (decision.type === "no_reply") {
      if (!shouldWaitForVoice(input.transcript)) throw new Error("Invalid silent voice decision.");
      return { action: "no_reply", reply: "" };
    }
    if (!allowed.has(decision.name))
      throw new Error("The voice assistant requested an unavailable function.");
    if (turn === limit) {
      // Out of calls: summarize instead of failing; request IDs let "continue" skip done effects.
      let summary = "";
      try {
        const final = parseVoiceAssistantDecision(
          await runHarnessTextPrompt({ ...request, prompt: prompt(input, observations, 0, true) }),
        );
        if (final.type === "reply") summary = final.text;
      } catch (error) {
        if (input.signal.aborted) throw error;
      }
      input.signal.throwIfAborted();
      return {
        action: "reply",
        reply: summary || voiceLimitFallback(input.transcript, observations.length),
        requestIds: observedRequestIds(observations),
      };
    }
    if (!progressSent && turn > 0 && elapsedSince(startedAt) >= VOICE_PROGRESS_AFTER_MS) {
      progressSent = true;
      input.onProgress?.(voiceProgressText(input.transcript));
    }
    const key = callKey(decision.name, decision.args);
    let result: unknown;
    if (attempts.has(key)) result = attempts.get(key);
    else {
      input.signal.throwIfAborted();
      try {
        result = observedResult(
          await voiceRuntimeDeadline(
            (wait) =>
              voiceToolWaitsForOwner(decision.name)
                ? input.execute(decision.name, decision.args, input.signal, wait)
                : input.execute(decision.name, decision.args, input.signal),
            input.signal,
          ),
        );
      } catch (error) {
        result = {
          status: "uncertain",
          error:
            error instanceof Error
              ? error.message
              : "The application tool did not return a verified result.",
          requestId: decision.args.requestId,
          retry: "Read the operation state before retrying. No automatic resend was made.",
        };
      }
      // Record even failures: a changed model-generated retry ID is not a new intent.
      attempts.set(key, result);
    }
    input.signal.throwIfAborted();
    observations.push({
      name: decision.name,
      args: decision.args,
      result: boundedData(result, MAX_RESULT),
    });
  }
  throw new Error("The voice request did not produce a reply.");
}
