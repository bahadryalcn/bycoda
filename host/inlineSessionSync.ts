import type { SessionSync } from "../src/features/connections/model/protocol";
import type { RemoteChangesInput, RemoteChangesValue } from "./remoteChanges";

/** Opportunistic deltas only. Oversized, missing and snapshot reads stay on the content lane. */
export function inlineSessionSync(
  input: RemoteChangesInput,
  changes: RemoteChangesValue,
  read: (id: string, revision: number) => SessionSync | undefined,
): RemoteChangesValue {
  if (!input.inlineSync || changes.reset) return changes;
  const selected =
    input.inlineSessionIds === undefined ? undefined : new Set(input.inlineSessionIds);
  let remaining = 64 * 1024 - Buffer.byteLength(JSON.stringify(changes));
  for (const entry of changes.sessions) {
    if (entry.deleted || remaining <= 0 || (selected && !selected.has(entry.sessionId))) continue;
    const cursor = input.sessions.find((value) => value.sessionId === entry.sessionId);
    if (!cursor || cursor.revision <= 0) continue;
    try {
      const sync = read(entry.sessionId, cursor.revision);
      if (
        !sync ||
        sync.kind !== "delta" ||
        sync.partial ||
        sync.blocks.length > 128 ||
        sync.blockIds.length > 4096 ||
        sync.base !== cursor.revision ||
        sync.value.revision !== entry.revision
      )
        continue;
      const bytes = Buffer.byteLength(JSON.stringify(sync)) + 8;
      if (bytes > remaining) continue;
      entry.sync = sync;
      remaining -= bytes;
    } catch {
      // The session may be deleted or change ownership between hint and read.
    }
  }
  return changes;
}
