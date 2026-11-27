import type { HostSession } from "../../src/features/connections/model/protocol";
import { SessionReadError } from "../domains/sessions/read-errors";
import type { SessionReadProcesses } from "../session-read-process";
import type { StoreDatabase } from "../store-db";
import { assertHostAuthority } from "./authority-fence";

/**
 * Parses a cold session in a child process before taking the Host-wide SQL
 * queue, so streaming writes are not stalled for the length of the parse. The
 * queue is entered only to admit the result: if a write or another reader got
 * there first, or the stored revision moved, the result is discarded and the
 * in-queue read stays authoritative. The signal abandons the child read.
 *
 * Resolves `"oversized"` when the transcript exceeds the child's reply budget:
 * the caller then reads it in the queue, as an unsignalled read would, instead
 * of refusing a conversation the Host can still serve in pages.
 */
export async function prefetchColdSession(options: {
  id: string;
  signal: AbortSignal;
  path: string;
  processes: SessionReadProcesses;
  db: StoreDatabase;
  resident: (id: string) => boolean;
  admit: (value: HostSession) => void;
}): Promise<"oversized" | undefined> {
  const { id, signal, db } = options;
  if (options.path === ":memory:" || options.resident(id)) return;
  signal.throwIfAborted();
  let value: HostSession | undefined;
  try {
    value = await options.processes.read<HostSession | undefined>(
      { kind: "host", path: options.path, sessionId: id },
      signal,
    );
  } catch (cause) {
    if (cause instanceof SessionReadError && cause.kind === "snapshot-budget") return "oversized";
    throw cause;
  }
  signal.throwIfAborted();
  if (!value || value.session.id !== id) return;
  await db.storeScope(async () => {
    if (signal.aborted || options.resident(id)) return;
    const source = await db.prepare("SELECT revision FROM session_state WHERE id=?").get(id);
    if (!source || Number(source.revision) !== value.revision) return;
    if (value.authorityGeneration !== undefined)
      await assertHostAuthority(db, id, value.authorityGeneration);
    options.admit(value);
  });
}
