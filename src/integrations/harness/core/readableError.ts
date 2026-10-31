// Internal native codes (NATIVE_*) are diagnostics, not user text. Keep the code
// in parentheses so a report can still be matched, but lead with plain words.
const FAMILIES: ReadonlyArray<[RegExp, string]> = [
  [/^NATIVE_CONTROL_TURN_/, "The turn changed before the provider started. Send again."],
  [/^NATIVE_CONTROL_/, "The provider could not be started for this turn. Send again."],
  [/^NATIVE_OUTPUT_/, "The provider output could not be attached to this conversation. Send again."],
  [/^NATIVE_PROCESS_/, "The provider process changed while it was being controlled. Try again."],
  [/^NATIVE_AUTHORITY_/, "This conversation is busy with another operation. Try again in a moment."],
  [/^NATIVE_EDITOR_DRAFT_/, "The editor recovery copy could not be saved."],
  [/^NATIVE_/, "An internal check failed. Try again."],
];

const CODE = /\bNATIVE_[A-Z0-9_]+\b/;

/** Plain-language text for a provider/native error; other text is returned unchanged. */
export function readableHarnessError(text: string): string {
  const match = CODE.exec(text);
  if (!match) return text;
  const code = match[0];
  const message = FAMILIES.find(([pattern]) => pattern.test(code))?.[1] ?? text;
  return `${message} (${code})`;
}
