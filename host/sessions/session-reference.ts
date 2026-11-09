import { NativeFenceEvidenceSchema } from "../../src/shared/model/host-contracts/authority";
import {
  SessionReferenceLocatorSchema,
  type SessionReferenceLocator,
} from "../../src/shared/model/host-contracts/session-reads";
import type { StoreDatabase } from "../store-db";
import { readStoredAuthorityDecision } from "../storage/authority-journal";

type ReferencePorts = {
  environmentId: string;
  database: Pick<StoreDatabase, "scope" | "prepare">;
  localReference(sessionId: string): Promise<SessionReferenceLocator | undefined>;
};

/** A link identifies data; it never creates, adopts or migrates its target. */
export async function assertSessionReference(
  ports: ReferencePorts,
  sessionId: string,
  raw: unknown,
): Promise<void> {
  try {
    const reference = SessionReferenceLocatorSchema.parse(raw);
    if (reference.sessionId !== sessionId) throw new Error("mismatch");
    const actual = await ports.localReference(sessionId);
    if (!actual || actual.sessionId !== sessionId) throw new Error("missing");
    if (reference.kind === "host") {
      if (
        actual.kind !== "host" ||
        reference.environmentId !== ports.environmentId ||
        actual.environmentId !== reference.environmentId
      )
        throw new Error("mismatch");
      return;
    }
    if (actual.kind === "native") {
      if (
        actual.sourceStoreId !== reference.sourceStoreId ||
        actual.sourceProfileId !== reference.sourceProfileId
      )
        throw new Error("mismatch");
      return;
    }
    if (actual.environmentId !== ports.environmentId) throw new Error("mismatch");
    // Only the current committed authority head may preserve an older Native address.
    await ports.database.scope(async () => {
      const row = await ports.database
        .prepare(`SELECT j.*,h.generation AS head_generation
        FROM host_authority_heads h JOIN host_authority_journal j
        ON j.migration_id=h.migration_id AND j.environment_id=h.environment_id
        AND j.session_id=h.session_id
        WHERE h.environment_id=? AND h.session_id=? AND h.phase='host-active'
        AND j.phase='host-active'`)
        .get(ports.environmentId, sessionId);
      if (!row || Number(row.generation) !== Number(row.head_generation) || !row.decision)
        throw new Error("missing receipt");
      const fence = NativeFenceEvidenceSchema.parse(JSON.parse(String(row.evidence)));
      if (
        fence.environmentId !== ports.environmentId ||
        fence.sessionId !== sessionId ||
        fence.sourceStoreId !== reference.sourceStoreId ||
        fence.sourceProfileId !== reference.sourceProfileId ||
        fence.generation !== Number(row.head_generation) ||
        fence.migrationId !== row.migration_id
      )
        throw new Error("mismatch");
      const decision = readStoredAuthorityDecision(
        row as unknown as Parameters<typeof readStoredAuthorityDecision>[0],
        fence,
      );
      if (decision.phase !== "host-active") throw new Error("uncommitted");
    });
  } catch {
    // Do not reveal whether another profile, store or session exists.
    throw new Error("Reference unavailable");
  }
}
