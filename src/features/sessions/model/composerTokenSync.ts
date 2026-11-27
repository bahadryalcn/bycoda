/** What the last slash, dollar and mention parse looked at. */
export type TokenSyncSnapshot = {
  value: string;
  /** Null while a range of text is selected. */
  cursor: number | null;
  /** Inputs besides the text that change a parse result (skill list, harness). */
  context: readonly unknown[];
};

/**
 * True when `next` would parse to what `last` already parsed. One typed
 * character fires input, select and keyup with the same text and caret, so
 * the follow-up events skip the parse. A changed skill list or harness still
 * parses again.
 */
export function tokenSyncUnchanged(
  last: TokenSyncSnapshot | null,
  next: TokenSyncSnapshot,
): boolean {
  return (
    last !== null &&
    last.value === next.value &&
    last.cursor === next.cursor &&
    last.context.length === next.context.length &&
    last.context.every((item, index) => Object.is(item, next.context[index]))
  );
}
