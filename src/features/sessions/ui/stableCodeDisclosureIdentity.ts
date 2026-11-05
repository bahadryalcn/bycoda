/** Exact source identities avoid hash collisions; duplicate counts invalidate ambiguous occurrences. */
export function stableCodeDisclosureIdentity(shells: readonly HTMLElement[]): Map<HTMLElement, string> {
  const counts = new Map<string, number>();
  const blockCounts = new Map<string, number>();
  const blockId = (shell: HTMLElement) => {
    const block = shell.closest<HTMLElement>("[data-selectable-agent-response], [data-transcript-virtual-block-id]");
    return block?.dataset.selectableAgentResponse ?? block?.dataset.transcriptVirtualBlockId;
  };
  for (const shell of shells) {
    const id = blockId(shell);
    if (id) blockCounts.set(id, (blockCounts.get(id) ?? 0) + 1);
  }
  const sources = new Map<HTMLElement, string>();
  for (const shell of shells) {
    const source = shell.dataset.codeIdentity;
    if (!source || source.length > 32768) continue;
    const id = blockId(shell);
    const identity = id && blockCounts.get(id) === 1
      ? JSON.stringify(["block", id])
      : JSON.stringify(["source", id ?? null, source]);
    sources.set(shell, identity);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  const result = new Map<HTMLElement, string>();
  for (const shell of shells) {
    const source = sources.get(shell);
    if (!source) continue;
    const occurrence = occurrences.get(source) ?? 0;
    occurrences.set(source, occurrence + 1);
    result.set(shell, JSON.stringify([source, counts.get(source), occurrence]));
  }
  return result;
}

export function captureCodeDisclosure(target: EventTarget | null, retention: { setDisclosure: (key: string, value: boolean | null) => void } | null | undefined): void {
  const control = target instanceof Element ? target.closest<HTMLButtonElement>(".markdown-code-toggle, .markdown-code-summary") : null;
  const shell = control?.closest<HTMLElement>(".markdown-code-shell");
  const turn = shell?.closest<HTMLElement>("[data-transcript-turn]");
  if (!control || !shell || !turn || !retention) return;
  const identity = stableCodeDisclosureIdentity([...turn.querySelectorAll<HTMLElement>(".markdown-code-shell")]).get(shell);
  if (identity) retention.setDisclosure(`code:${turn.dataset.transcriptTurn}:${identity}`, control.matches(".markdown-code-summary") ? false : shell.dataset.collapsed !== "true");
}
