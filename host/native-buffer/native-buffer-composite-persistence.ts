import type { Buffer } from "node:buffer";
import type {
  NativeBufferCertificateReference,
  NativeBufferCompletionCertificate,
  NativeBufferPersistence,
} from "../ports/native-buffer-persistence";
import type { NativeBufferGitPersistence } from "./native-buffer-git-persistence";

/**
 * Git store primary, SQL store as a read-only legacy fallback for exact-key reads. Every
 * write, every clock operation and every listing goes to the primary. The legacy half
 * disappears once the maintenance pass (or `host.mjs native-buffer legacy-release`) drops
 * the SQL content tables.
 */
export function createNativeBufferCompositePersistence(options: {
  primary: NativeBufferGitPersistence;
  legacy: NativeBufferPersistence;
}): NativeBufferPersistence {
  const { primary, legacy } = options;
  return {
    readClock: (reportId) => primary.readClock(reportId),
    initializeClock: (state, authorize) => primary.initializeClock(state, authorize),
    advanceClock: (expected, next, authorize) => primary.advanceClock(expected, next, authorize),
    complete: (batch) => primary.complete(batch),
    directoryView: () => primary.directoryView(),
    async read(key: string, limit: number): Promise<Buffer | null> {
      return (await primary.read(key, limit)) ?? legacy.read(key, limit);
    },
    // Presence follows the listing (primary only) so the directories layer never sees a
    // name that `entries()` would not return.
    hasEntry: (directory, name, view) => primary.hasEntry(directory, name, view),
    async readCertificate(
      ref: NativeBufferCertificateReference,
      limit: number,
    ): Promise<NativeBufferCompletionCertificate | null> {
      return (await primary.readCertificate(ref, limit)) ?? legacy.readCertificate(ref, limit);
    },
    // Listing comes from the primary only: the directories layer validates cursors as
    // `directory-rowid:<N>` with N bounded by `directoryView()`, which a merged listing
    // cannot honour. Legacy content is never listed again; it stays readable by exact key
    // until the maintenance pass releases it.
    entries: (directory, after, limit, view) => primary.entries(directory, after, limit, view),
  };
}
