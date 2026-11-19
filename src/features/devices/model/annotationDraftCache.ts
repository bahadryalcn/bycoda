/** Retained device-panel annotation drafts, keyed by the conversation/machine draft scope. */

/** Most scopes kept once nothing mounted needs them. */
export const ANNOTATION_DRAFT_MAX_SCOPES = 32;
/** Summed screenshot base64 length (characters) kept across scopes. */
export const ANNOTATION_DRAFT_MAX_FRAME_CHARS = 32 * 1024 * 1024;

type FrameDraft = { frame: { base64: string } };
type ScopeDrafts<T> = Record<string, T>;

const scopeFrameChars = <T extends FrameDraft>(drafts: ScopeDrafts<T>) =>
  Object.values(drafts).reduce((sum, draft) => sum + draft.frame.base64.length, 0);

/**
 * Creates the draft cache. Scopes are never merged, so a draft is only ever returned to the
 * conversation and machine that wrote it. Eviction drops the least recently written scope first
 * and never drops the scope just written or one a mounted panel has pinned, so an editable draft
 * on screen is kept even when it alone exceeds the budget.
 */
export function createAnnotationDraftCache<T extends FrameDraft>(
  limits: { maxScopes?: number; maxFrameChars?: number } = {},
) {
  const maxScopes = limits.maxScopes ?? ANNOTATION_DRAFT_MAX_SCOPES;
  const maxFrameChars = limits.maxFrameChars ?? ANNOTATION_DRAFT_MAX_FRAME_CHARS;
  const entries = new Map<string, ScopeDrafts<T>>();
  const mounted: string[] = [];

  function trim(keep: string) {
    let chars = 0;
    for (const drafts of entries.values()) chars += scopeFrameChars(drafts);
    for (const scope of entries.keys()) {
      if (entries.size <= maxScopes && chars <= maxFrameChars) return;
      if (scope === keep || mounted.includes(scope)) continue;
      chars -= scopeFrameChars(entries.get(scope)!);
      entries.delete(scope);
    }
  }

  return {
    get: (scope: string) => entries.get(scope),
    /** Replaces the scope's drafts; an empty record removes the scope. */
    set(scope: string, drafts: ScopeDrafts<T>) {
      entries.delete(scope);
      if (!Object.keys(drafts).length) return;
      entries.set(scope, drafts);
      trim(scope);
    },
    delete: (scope: string) => entries.delete(scope),
    /** Marks a scope as shown by a mounted panel; returns the release function. */
    pin(scope: string) {
      mounted.push(scope);
      return () => {
        const index = mounted.indexOf(scope);
        if (index >= 0) mounted.splice(index, 1);
      };
    },
    scopes: () => [...entries.keys()],
  };
}
