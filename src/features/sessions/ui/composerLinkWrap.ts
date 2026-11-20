/**
 * Measures, for every link boxed in the composer overlay, whether it wraps across lines.
 * One registry serves the whole overlay: a pass reads all the links first and only then
 * applies the results, so the links share a single layout flush and a flip in one never
 * forces a second layout before the next is read.
 */
export interface LinkWrapRegistry {
  /** Tracks a link element; `apply` receives whether it spans more than one line. Returns the untrack function. */
  add(element: HTMLElement, apply: (wrapped: boolean) => void): () => void;
  /** Reads every tracked link, then applies the results. */
  measure(): void;
  /** Measures after a commit only when the draft changed or a link was added since the last pass. */
  settle(draft: string): void;
}

export function createLinkWrapRegistry(): LinkWrapRegistry {
  const links = new Map<HTMLElement, (wrapped: boolean) => void>();
  let added = false;
  let settledDraft: string | null = null;

  const measure = () => {
    const wrapped = [...links.keys()].map((element) => element.getClientRects().length > 1);
    let index = 0;
    for (const apply of links.values()) apply(wrapped[index++] ?? false);
  };

  return {
    add(element, apply) {
      links.set(element, apply);
      added = true;
      return () => {
        links.delete(element);
      };
    },
    measure,
    settle(draft) {
      if (!added && settledDraft === draft) return;
      added = false;
      settledDraft = draft;
      measure();
    },
  };
}
