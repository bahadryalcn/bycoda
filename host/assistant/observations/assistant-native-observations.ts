import { createHash } from "node:crypto";
import { z } from "zod";
import type { HostStore } from "../../store";
import type { AssistantObservationJournal } from "./assistant-observation-journal";

const id = z.string().min(1).max(200).refine(s => s.trim() === s && !s.includes("\0"));
const entry = z.strictObject({ sequence: z.number().int().positive().safe(), sourceId: id,
  revision: z.number().int().positive().safe(), change: z.enum(["created", "updated", "deleted"]),
  sourceCwd: z.string().min(1).max(4096).refine(s => !s.includes("\0")).nullable(),
  occurredAt: z.number().int().nonnegative().safe() });
export const nativeObservationOperation = z.strictObject({ hostId: id, installationId: id,
  source: z.enum(["note", "server", "native-session"]), entries: z.array(entry).min(1).max(100) });
export type NativeObservationOperation = z.infer<typeof nativeObservationOperation>;

/** Caller verifies exact signed operation and holds native authority lease throughout.
 * Resolve cwd against the actual Host and live Native privacy scope; null is deferred.
 * Scope is checked again inside the transaction using the captured synchronous guard. */
export async function ingestNativeObservations(options: {
  store: HostStore; journal: AssistantObservationJournal; operation: unknown;
  verifiedHostId: string; verifiedInstallationId: string;
  resolve(cwd: string): Promise<{ projectId: string; valid(): boolean } | null>;
  /** Native-owner capture, bound to this verified installation; default denied. */
  resolvePersonal?(): Promise<{ valid(): boolean } | null>;
  valid(): boolean;
}) {
  const { store, journal } = options;
  const operation = nativeObservationOperation.parse(options.operation);
  if (operation.hostId !== options.verifiedHostId || operation.hostId !== store.environmentId ||
      operation.installationId !== options.verifiedInstallationId || !options.valid())
    throw new Error("Native observation authority changed.");
  if (operation.source === "server" && operation.entries.some(item => item.sourceCwd !== null)) throw new Error("Server observations cannot claim a project scope.");
  if (operation.source === "native-session" && operation.entries.some(item => item.sourceCwd === null)) throw new Error("Native session observations require an exact project scope.");
  const unique = new Set<string>();
  const resolved: { item: z.infer<typeof entry>; projectId?: string; valid(): boolean }[] = [];
  const deferred: number[] = [];
  for (const item of operation.entries) {
    const key = `${item.sequence}:${item.sourceId}:${item.revision}`;
    if (unique.has(key)) throw new Error("Duplicate Native observation identity.");
    unique.add(key);
    const scope = item.sourceCwd ? await options.resolve(item.sourceCwd) : await options.resolvePersonal?.() ?? null;
    if (!options.valid()) throw new Error("Native observation authority changed.");
    if (!scope || (item.sourceCwd && (!('projectId' in scope) || !id.safeParse(scope.projectId).success)) || !scope.valid()) { deferred.push(item.sequence); continue; }
    resolved.push({ item, ...scope });
  }
  await journal.ready;
  await store.db.exec(`CREATE TABLE IF NOT EXISTS assistant_native_observation_receipts_v2 (
    installation_id TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL,
    fingerprint TEXT NOT NULL, journal_sequence INTEGER NOT NULL,
    PRIMARY KEY(installation_id,source_kind,source_id,revision)
  )`);
  if (await store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='assistant_native_observation_receipts'").get())
    await store.db.exec("INSERT OR IGNORE INTO assistant_native_observation_receipts_v2 SELECT installation_id,'note',source_id,revision,fingerprint,journal_sequence FROM assistant_native_observation_receipts");
  const receipts = await store.transaction(async () => {
    const committed = [];
    for (const { item, projectId, valid } of resolved) {
      if (!options.valid() || !valid()) throw new Error("Native observation scope changed.");
      const fingerprint = createHash("sha256").update(JSON.stringify([item, projectId ?? null])).digest("hex");
      const prior = await store.db.prepare("SELECT fingerprint,journal_sequence FROM assistant_native_observation_receipts_v2 WHERE installation_id=? AND source_kind=? AND source_id=? AND revision=?")
        .get(operation.installationId, operation.source, item.sourceId, item.revision);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error("Native observation identity was reused with different metadata.");
        committed.push({ sequence: item.sequence, sourceId: item.sourceId, revision: item.revision, journalSequence: Number(prior.journal_sequence) });
        continue;
      }
      const sourceId = `native-${operation.source}:${createHash("sha256").update(JSON.stringify([operation.installationId, item.sourceId])).digest("hex")}`;
      const saved = await journal.append({ source: operation.source, sourceId, sourceRevision: `native:${item.revision}`,
        change: item.change, projectIds: projectId ? [projectId] : [], ...(projectId ? operation.source === "native-session" ? { producerInstallationId: operation.installationId } : {} : { nativeInstallationId: operation.installationId }), occurredAt: item.occurredAt });
      await store.db.prepare("INSERT INTO assistant_native_observation_receipts_v2 VALUES(?,?,?,?,?,?)")
        .run(operation.installationId, operation.source, item.sourceId, item.revision, fingerprint, saved.sequence);
      committed.push({ sequence: item.sequence, sourceId: item.sourceId, revision: item.revision, journalSequence: saved.sequence });
    }
    if (!options.valid() || resolved.some(scope => !scope.valid())) throw new Error("Native observation scope changed.");
    return committed;
  });
  return { receipts, deferred };
}
