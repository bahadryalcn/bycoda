/** A local received-text bound, never evidence of provider token usage or a billing cap. */
export function validateTextOutputLimit(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
    throw new Error("Invalid utility output allowance.");
}

export function utilityOutputExceeded(
  output: string,
  reasoningChars: number,
  limit: number | undefined,
): boolean {
  return limit !== undefined && output.length + reasoningChars > limit;
}
