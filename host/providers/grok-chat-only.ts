import type {
  HarnessOperationContext,
  SendTurnInput,
} from "../../src/integrations/harness/core/types";
import {
  assertProviderOperation,
  finishProviderOperation,
} from "../../src/integrations/harness/providers/turnWriter";

// Exact public API model IDs; retired aliases and Grok Build-only models are not equivalent.
const MODELS = new Set(["grok-4.5", "grok-4.6", "grok-4.7"]);
const ENDPOINT = "https://api.x.ai/v1/chat/completions";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_CHARS = 100_000;
const MAX_PROMPT_CHARS = 16_000;
const TIMEOUT_MS = 240_000;
const active = new Map<string, { controller: AbortController; operation?: object }>();

function apiModel(model: string): string | undefined {
  if (typeof model !== "string") return undefined;
  const id = model.startsWith("grok:") ? model.slice(5) : model;
  return MODELS.has(id) ? id : undefined;
}

/** Capability only: an API key and exact public model do not prove provider availability or quota. */
export function grokChatOnlyAvailable(ref: { model: string; providerAccountId?: string }): boolean {
  return (
    (!ref.providerAccountId || ref.providerAccountId === "default") &&
    process.env.BYCODA_GROK_CHAT_ONLY_API === "1" &&
    !!process.env.XAI_API_KEY?.trim() &&
    !!apiModel(ref.model)
  );
}

/** Cancel an active request; an operation, when supplied, must be the original operation. */
export function cancelGrokChatOnly(id: string, context?: HarnessOperationContext): boolean {
  const current = active.get(id);
  if (!current || (context?.operation && current.operation !== context.operation)) return false;
  current.controller.abort();
  return true;
}

async function responseText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error("Grok API returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Grok API response exceeded the size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** One tool-free API turn. Host supplies the bounded recorded conversation for continuation. */
export async function sendGrokChatOnly(input: SendTurnInput): Promise<void> {
  try {
    await runGrokChatOnly(input);
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

async function runGrokChatOnly(input: SendTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);
  const model = apiModel(input.model);
  const key = process.env.XAI_API_KEY?.trim();
  if (!key || !model || !grokChatOnlyAvailable(input))
    throw new Error(
      "Grok files:false requires API opt-in, a default-account XAI_API_KEY and supported exact API model.",
    );
  const effort = input.modelSettings?.effort ?? input.modelSettings?.reasoning;
  const allowedEfforts =
    model === "grok-4.5" ? ["low", "medium", "high"] : ["low", "medium", "high", "xhigh"];
  if (
    (effort !== undefined && !allowedEfforts.includes(effort)) ||
    (input.modelSettings?.effort !== undefined &&
      input.modelSettings?.reasoning !== undefined &&
      input.modelSettings.effort !== input.modelSettings.reasoning)
  )
    throw new Error("Grok API does not support the selected reasoning effort for this model.");
  if (
    typeof input.sessionId !== "string" ||
    !input.sessionId ||
    typeof input.text !== "string" ||
    !input.text ||
    input.text.length > MAX_PROMPT_CHARS ||
    (input.chatOnlyHistory !== undefined &&
      (typeof input.chatOnlyHistory !== "string" ||
        input.chatOnlyHistory.length > MAX_HISTORY_CHARS)) ||
    input.attachments?.length
  )
    throw new Error("Invalid Grok chat-only input.");
  if (active.has(input.sessionId)) throw new Error("Grok chat-only turn is already running.");
  const controller = new AbortController();
  const entry = { controller, operation: input.operationContext?.operation };
  active.set(input.sessionId, entry);
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const messages = [
      { role: "system", content: "You are a helpful assistant. You have no tools or file access." },
      ...(input.chatOnlyHistory
        ? [{ role: "user", content: `Earlier conversation:\n${input.chatOnlyHistory}` }]
        : []),
      { role: "user", content: input.text },
    ];
    const response = await fetch(ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(effort ? { reasoning_effort: effort } : {}),
      }),
    }).catch(() => {
      throw new Error("Grok API request failed.");
    });
    assertProviderOperation(input.operationContext);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Grok API request failed (HTTP ${response.status}).`);
    }
    input.onAccepted?.();
    input.onEvent({ type: "turn.started" });
    const body = await responseText(response, controller.signal).catch(() => {
      throw new Error("Grok API response could not be read within its size limit.");
    });
    controller.signal.throwIfAborted();
    assertProviderOperation(input.operationContext);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("Grok API returned invalid JSON.");
    }
    const record =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
    const choices = record?.choices;
    const choice =
      Array.isArray(choices) && choices.length === 1 && choices[0] && typeof choices[0] === "object"
        ? (choices[0] as Record<string, unknown>)
        : undefined;
    const message =
      choice?.message && typeof choice.message === "object"
        ? (choice.message as Record<string, unknown>)
        : undefined;
    if (
      choice?.finish_reason !== "stop" ||
      message?.role !== "assistant" ||
      typeof message.content !== "string" ||
      !message.content ||
      message.tool_calls
    )
      throw new Error("Grok API returned an incomplete or unsupported response.");
    input.onEvent({ type: "message.delta", text: message.content });
    input.onEvent({ type: "message.completed" });
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Grok chat-only request cancelled or timed out.");
    // Do not expose network errors: they may contain request headers or URLs.
    if (error instanceof TypeError) throw new Error("Grok API request failed.");
    throw error;
  } finally {
    clearTimeout(timer);
    if (active.get(input.sessionId) === entry) active.delete(input.sessionId);
  }
}
