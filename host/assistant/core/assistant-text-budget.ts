/** Scheduling estimates only: provider overhead and hidden retained context are unknown. */
export type AssistantTextLimits = {
  maxOutputTokens: number;
  maxOutputChars: number;
};

export class AssistantTextPreflightError extends Error {
  readonly code = "ASSISTANT_TEXT_PREFLIGHT_TOO_LARGE";
  constructor() {
    super(
      "The conversation exceeds its review reservation. Increase the reservation before sending again.",
    );
  }
}

export function assistantTextLimits(
  prompt: string,
  tokenCap: number,
  phases = 1,
): AssistantTextLimits {
  const estimatedInput = Math.ceil(Buffer.byteLength(prompt, "utf8") / 4);
  const remaining = Math.floor((tokenCap - estimatedInput) / phases);
  if (
    !Number.isSafeInteger(tokenCap) ||
    tokenCap < 1 ||
    !Number.isSafeInteger(phases) ||
    phases < 1 ||
    remaining < 1
  )
    throw new AssistantTextPreflightError();
  return {
    maxOutputTokens: remaining,
    maxOutputChars: Math.min(64000, remaining * 4),
  };
}
