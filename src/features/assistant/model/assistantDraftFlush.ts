type DraftFlusher = { flush: () => Promise<void>; active: boolean };
const owners = new Set<DraftFlusher>();
const operations = new Set<Promise<void>>();

/** Admission is synchronous; release only after durable handoff or completion. */
export function beginAssistantDraftOperation(): () => void {
  let release!: () => void;
  const operation = new Promise<void>((resolve) => { release = resolve; });
  operations.add(operation);
  return () => { operations.delete(operation); release(); };
}

/** Keep a failed, unmounted owner's draft until a later verified flush/recovery. */
export function registerAssistantDraftFlusher(flush: () => Promise<void>): () => void {
  const owner: DraftFlusher = { flush, active: true };
  owners.add(owner);
  return () => {
    owner.active = false;
    void owner.flush().then(() => owners.delete(owner), () => {});
  };
}

/** Window close must not outrun accepted or still-pending native draft writes. */
export async function flushAssistantDrafts(): Promise<void> {
  while (operations.size) await Promise.all([...operations]);
  for (const owner of [...owners]) {
    await owner.flush();
    if (!owner.active) owners.delete(owner);
  }
}
