import type {
  HarnessOperationContext,
  SendTurnInput,
} from "../../src/integrations/harness/core/types";
import {
  assertProviderOperation,
  finishProviderOperation,
} from "../../src/integrations/harness/providers/turnWriter";

// Gemini Developer API text model IDs.
const MODELS = new Set([
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
]);
const MAX_INPUT = 512 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

type ModelRef = { model: string; providerAccountId?: string };
type Active = { controller: AbortController; operation?: object; timedOut: boolean };
const active = new Map<string, Active>();

function apiSelection(model: string): { id: string; effort?: string } | undefined {
  const id = model.startsWith("antigravity:") ? model.slice("antigravity:".length) : model;
  if (MODELS.has(id)) return { id };
  // Antigravity publishes these three selections for the same Gemini 3.8 Flash family.
  const effort = /^gemini-3\.8-flash-(low|medium|high)$/.exec(id)?.[1];
  if (effort) return { id: "gemini-3.8-flash", effort };
  return undefined;
}

function thinkingConfig(
  model: string,
  effort?: string,
): { thinkingConfig: { thinkingLevel: string } } | undefined {
  if (!effort || effort === "default" || effort === "auto") return undefined;
  if (model.startsWith("gemini-2.5-") || !["low", "medium", "high"].includes(effort)) {
    throw new Error(
      "Gemini API chat-only mode cannot honor this effort setting for the selected model.",
    );
  }
  return { thinkingConfig: { thinkingLevel: effort.toUpperCase() } };
}

/** Explicit Host opt-in: an OAuth sign-in never implies use of a different API key. */
export function geminiChatOnlyAvailable(ref: ModelRef): boolean {
  return (
    process.env.BYCODA_GEMINI_CHAT_ONLY_API === "1" &&
    !!process.env.GEMINI_API_KEY?.trim() &&
    (ref.providerAccountId === undefined || ref.providerAccountId === "default") &&
    !!apiSelection(ref.model)
  );
}

/** A stale operation cannot cancel a newer request occupying the same session. */
export function cancelGeminiChatOnly(
  sessionId: string,
  context?: HarnessOperationContext,
): boolean {
  const current = active.get(sessionId);
  if (!current || (context?.operation !== undefined && context.operation !== current.operation))
    return false;
  current.controller.abort();
  return true;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Gemini returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE) throw new Error("Gemini response exceeded its size limit.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function responseText(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("Gemini returned an invalid response.");
  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1)
    throw new Error("Gemini returned no answer.");
  const candidate = candidates[0] as { finishReason?: unknown; content?: { parts?: unknown } };
  if (candidate.finishReason !== "STOP" || !Array.isArray(candidate.content?.parts))
    throw new Error("Gemini did not complete the answer.");
  const parts = candidate.content.parts as Array<{
    text?: unknown;
    thought?: unknown;
    functionCall?: unknown;
  }>;
  if (parts.some((part) => !part || typeof part !== "object" || part.functionCall !== undefined))
    throw new Error("Gemini returned an unsupported response.");
  const text = parts
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  if (!text.trim()) throw new Error("Gemini returned no answer.");
  return text;
}

/** One stateless, tool-free API turn. History comes from the Host's bounded saved transcript. */
export async function sendGeminiChatOnly(input: SendTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);
  try {
    if (!geminiChatOnlyAvailable(input))
      throw new Error("Gemini API chat-only mode is unavailable for this account or model.");
    if (input.attachments?.length)
      throw new Error("Gemini API chat-only mode does not support attachments.");
    if (active.has(input.sessionId)) throw new Error("A Gemini chat-only turn is already running.");
    if (
      !input.text.trim() ||
      input.text.length +
        (input.chatOnlyHistory?.length ?? 0) +
        (input.runtimeInstructions?.length ?? 0) >
        MAX_INPUT
    )
      throw new Error("Gemini chat-only input is empty or too large.");
    const selection = apiSelection(input.model)!;
    const model = selection.id;
    const effort = input.modelSettings?.effort;
    if (
      selection.effort &&
      effort &&
      effort !== "default" &&
      effort !== "auto" &&
      effort !== selection.effort
    )
      throw new Error("Gemini API chat-only effort conflicts with the selected model.");
    const generationConfig = thinkingConfig(model, selection.effort ?? effort);
    const key = process.env.GEMINI_API_KEY!.trim();
    const current: Active = {
      controller: new AbortController(),
      operation: input.operationContext?.operation,
      timedOut: false,
    };
    active.set(input.sessionId, current);
    const timer = setTimeout(() => {
      current.timedOut = true;
      current.controller.abort();
    }, TIMEOUT_MS);
    try {
      const text = input.chatOnlyHistory ? `${input.chatOnlyHistory}\n\n${input.text}` : input.text;
      const body = {
        contents: [{ role: "user", parts: [{ text }] }],
        ...(input.runtimeInstructions
          ? { systemInstruction: { parts: [{ text: input.runtimeInstructions }] } }
          : {}),
        ...(generationConfig ? { generationConfig } : {}),
      };
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify(body),
            signal: current.controller.signal,
            redirect: "error",
          },
        );
      } catch {
        throw new Error(
          current.timedOut
            ? "Gemini request timed out."
            : current.controller.signal.aborted
              ? "Gemini request cancelled."
              : "Gemini request failed.",
        );
      }
      if (current.controller.signal.aborted)
        throw new Error(
          current.timedOut ? "Gemini request timed out." : "Gemini request cancelled.",
        );
      if (!response.ok) throw new Error(`Gemini request failed (HTTP ${response.status}).`);
      input.onAccepted?.();
      let result: unknown;
      try {
        result = await boundedJson(response);
      } catch {
        throw new Error("Gemini response could not be read.");
      }
      if (current.controller.signal.aborted)
        throw new Error(
          current.timedOut ? "Gemini request timed out." : "Gemini request cancelled.",
        );
      assertProviderOperation(input.operationContext);
      input.onEvent({ type: "message.delta", text: responseText(result) });
      input.onEvent({ type: "message.completed" });
      if (result && typeof result === "object") {
        const usage = (
          result as {
            usageMetadata?: {
              promptTokenCount?: unknown;
              candidatesTokenCount?: unknown;
              cachedContentTokenCount?: unknown;
            };
          }
        ).usageMetadata;
        const valid = (value: unknown): value is number =>
          typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
        if (
          usage &&
          (valid(usage.promptTokenCount) ||
            valid(usage.candidatesTokenCount) ||
            valid(usage.cachedContentTokenCount))
        )
          input.onEvent({
            type: "turn.metrics",
            ...(valid(usage.promptTokenCount) ? { inputTokens: usage.promptTokenCount } : {}),
            ...(valid(usage.candidatesTokenCount)
              ? { outputTokens: usage.candidatesTokenCount }
              : {}),
            ...(valid(usage.cachedContentTokenCount)
              ? { cacheReadTokens: usage.cachedContentTokenCount }
              : {}),
          });
      }
    } finally {
      clearTimeout(timer);
      if (active.get(input.sessionId) === current) active.delete(input.sessionId);
    }
  } finally {
    finishProviderOperation(input.operationContext);
  }
}
