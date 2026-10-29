/**
 * How the Composer treats a draft handed down by its parent while the textarea
 * is mounted. The DOM stays the edit authority: an equal value is only an echo
 * of what the Composer published, and a different one is written once, never in
 * the middle of an IME composition.
 */
export type ExternalDraftAction =
  /** No draft to apply. Clearing is the reset token's job, not this path's. */
  | "ignore"
  /** The textarea already shows the draft. */
  | "echo"
  /** The draft differs from the textarea and must replace it. */
  | "replace"
  /** The draft differs, but an IME composition is active. */
  | "defer";

export function externalDraftAction(input: {
  external: string | undefined;
  domValue: string;
  composing: boolean;
}): ExternalDraftAction {
  if (!input.external) return "ignore";
  if (input.domValue === input.external) return "echo";
  return input.composing ? "defer" : "replace";
}

export type DeferredExternalDraft = { text: string; revision: number };

/**
 * After the composition ends, a deferred draft is applied only if the user made
 * no edit since it was deferred (the revision still matches) and the textarea
 * still differs. Anything typed or composed in the meantime wins; the Composer
 * also drops the deferred draft when the composition itself changed the text.
 */
export function deferredExternalDraftToApply(input: {
  deferred: DeferredExternalDraft | null;
  revision: number;
  domValue: string;
}): string | null {
  const { deferred } = input;
  if (!deferred || deferred.revision !== input.revision) return null;
  return deferred.text === input.domValue ? null : deferred.text;
}
