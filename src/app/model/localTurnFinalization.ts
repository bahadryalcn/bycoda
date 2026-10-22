/** An old turn may retire its transport, but must never finalize its replacement. */
export async function finalizeLocalTurn(options: {
  isCurrent: () => boolean;
  retire: () => Promise<void>;
  /** Close the old turn's recording even when a replacement owns the UI. */
  settle?: () => Promise<void>;
  checkpoint: () => Promise<void>;
  commit: () => void;
}): Promise<boolean> {
  // Failure retirement still belongs to the old transport after Stop. The
  // caller holds new dispatch until this completes.
  await options.retire();
  await options.settle?.();
  if (!options.isCurrent()) return false;
  await options.checkpoint();
  if (!options.isCurrent()) return false;
  options.commit();
  return true;
}
