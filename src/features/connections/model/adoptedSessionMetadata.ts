import type { HostSession } from "./protocol";

/** The sidebar state a conversation keeps in this desktop's own session store,
 * not in the transcript the mirror merges. */
export type HostSessionMetadata = { archived: boolean; pinned: boolean };

/**
 * What a remote device changed on the host copy, to carry into this desktop's
 * own store. Only a value that moved since the last one seen is applied, so an
 * archive or pin made here after the host copy was taken is never undone by
 * the host's older value.
 *
 * `seedOnly`: a session already on the host before this window started has no
 * trusted earlier value (this desktop may have changed it while the host
 * copy stood still), so its current value is only remembered. A session the
 * host adopted while this window ran starts from this desktop's own value, so
 * any difference is the remote change.
 */
export function hostMetadataPatch(
  seen: HostSessionMetadata | undefined,
  host: Pick<HostSession, "archived" | "pinned">,
  seedOnly: boolean,
): Partial<HostSessionMetadata> | undefined {
  const current = { archived: !!host.archived, pinned: !!host.pinned };
  if (!seen && seedOnly) return undefined;
  const patch: Partial<HostSessionMetadata> = {};
  if (!seen || seen.archived !== current.archived) patch.archived = current.archived;
  if (!seen || seen.pinned !== current.pinned) patch.pinned = current.pinned;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Remembers each host copy's last seen archived/pinned state and hands the
 * changes to `apply`. `listed` is the first host listing of this window.
 */
export function createHostMetadataMirror(
  apply: (
    sessionId: string,
    projectId: string,
    patch: Partial<HostSessionMetadata>,
  ) => Promise<void>,
) {
  const seen = new Map<string, HostSessionMetadata>();
  let initial: ReadonlySet<string> | undefined;
  return {
    /** Records which sessions the host already had when this window started. */
    start(ids: readonly string[]) {
      initial ??= new Set(ids);
    },
    async observe(host: HostSession, isNew = false): Promise<void> {
      const id = host.session.id;
      const previous = seen.get(id);
      const patch = hostMetadataPatch(previous, host, !isNew && initial?.has(id) !== false);
      // Remembered only after it is applied, so a failed write is tried again.
      const next = { archived: !!host.archived, pinned: !!host.pinned };
      if (patch) await apply(id, host.projectId, patch);
      seen.set(id, next);
    },
  };
}
