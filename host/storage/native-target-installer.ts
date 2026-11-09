import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  HostAuthorityDecisionSchema,
  NativeFenceEvidenceSchema,
  hostAuthorityDecisionDigestInput,
  type HostAuthorityDecision,
} from "../../src/shared/model/host-contracts/authority";
import { IdentifierSchema, JsonValueSchema } from "../../src/shared/model/host-contracts/schemas";
import type { HostStore } from "../store";
import type { AuthorityStage } from "./authority-journal";
import {
  createNativeSnapshotConverter,
  validateNativeMigrationTarget,
} from "./native-snapshot-converter";

const MAX_BYTES = 32 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export class NativeTargetInstallationError extends Error {
  readonly code = "NATIVE_TARGET_INSTALLATION_REJECTED";
  constructor(reason: string) {
    super(`Native target installation rejected: ${reason}`);
    this.name = "NativeTargetInstallationError";
  }
}
function reject(reason: string): never {
  throw new NativeTargetInstallationError(reason);
}

/** SQL-only journal callback. This does not verify actors or grant authority.
 * The journal must have performed trusted verification and moved its exact head
 * inside the same critical transaction. No independent save/replay path exists.
 */
export function createNativeTargetInstaller(options: {
  store: HostStore;
  projectId: string;
  expectedCwd: string;
}): (stage: AuthorityStage, decision: HostAuthorityDecision) => Promise<void> {
  const store = options.store;
  const projectId = IdentifierSchema.parse(options.projectId);
  const expectedCwd = options.expectedCwd;
  const converter = createNativeSnapshotConverter({ projectId, expectedCwd });
  return async (stage, rawDecision) => {
    if (!store.transactionActive || !store.db.ownsScope)
      reject("critical journal transaction required");
    store.db.assertCriticalScope();
    const fence = NativeFenceEvidenceSchema.parse(stage.fence);
    const decision = HostAuthorityDecisionSchema.parse(rawDecision);
    if (
      decision.phase !== "host-active" ||
      fence.environmentId !== store.environmentId ||
      decision.sourceGeneration !== fence.generation ||
      decision.authorityGeneration !== fence.generation ||
      decision.targetDigest !== stage.targetDigest ||
      hash(hostAuthorityDecisionDigestInput(decision)) !== decision.decisionDigest ||
      [
        "environmentId",
        "sessionId",
        "migrationId",
        "sourceStoreId",
        "sourceProfileId",
        "sourceRevision",
        "sourceDigest",
        "evidenceDigest",
        "minWriterProtocol",
      ].some(
        (key) => decision[key as keyof HostAuthorityDecision] !== fence[key as keyof typeof fence],
      )
    )
      reject("decision scope or generation changed");
    if (stage.converterVersion !== converter.version) reject("converter version changed");

    const row = await store.db
      .prepare(`SELECT j.*,h.generation AS head_generation,h.phase AS head_phase,h.migration_id AS head_migration
      FROM host_authority_journal j JOIN host_authority_heads h
      ON h.environment_id=j.environment_id AND h.session_id=j.session_id
      WHERE j.migration_id=? AND j.environment_id=? AND j.session_id=?`)
      .get(fence.migrationId, fence.environmentId, fence.sessionId);
    if (
      !row ||
      row.phase !== "host-active" ||
      row.head_phase !== "host-active" ||
      row.head_migration !== fence.migrationId ||
      Number(row.head_generation) !== fence.generation ||
      Number(row.generation) !== fence.generation ||
      row.target_digest !== stage.targetDigest ||
      row.converter_version !== converter.version ||
      row.source_json !== stage.sourceJson ||
      typeof row.source_json !== "string" ||
      typeof row.target_json !== "string" ||
      typeof row.evidence !== "string" ||
      typeof row.decision !== "string"
    )
      reject("current journal installation does not match");
    const sourceJson = row.source_json as string;
    const targetJson = row.target_json as string;
    if (
      Buffer.byteLength(sourceJson, "utf8") > MAX_BYTES ||
      Buffer.byteLength(targetJson, "utf8") > MAX_BYTES ||
      Buffer.from(sourceJson, "utf8").toString("utf8") !== sourceJson ||
      Buffer.from(targetJson, "utf8").toString("utf8") !== targetJson ||
      hash(sourceJson) !== fence.sourceDigest ||
      hash(targetJson) !== stage.targetDigest
    )
      reject("immutable snapshot bytes changed");
    if (
      !isDeepStrictEqual(
        NativeFenceEvidenceSchema.parse(JSON.parse(row.evidence as string)),
        fence,
      ) ||
      !isDeepStrictEqual(
        HostAuthorityDecisionSchema.parse(JSON.parse(row.decision as string)),
        decision,
      )
    )
      reject("retained journal evidence or decision changed");

    // Hash the original retained JSON before schema parsing can reorder keys.
    // The complete private envelope stays in the journal, never in a session DTO.
    const rawTarget: unknown = JSON.parse(targetJson);
    if (!isDeepStrictEqual(rawTarget, stage.normalizedSnapshot)) reject("callback target changed");
    const target = validateNativeMigrationTarget(rawTarget);
    const converted = validateNativeMigrationTarget(
      converter.convert(JsonValueSchema.parse(JSON.parse(sourceJson)), fence),
    );
    if (!isDeepStrictEqual(converted, target))
      reject("source preservation or normalized target changed");
    if (
      target.hostSession.projectId !== projectId ||
      target.hostSession.session.cwd !== expectedCwd ||
      target.hostSession.session.id !== fence.sessionId ||
      target.hostSession.authorityGeneration !== decision.authorityGeneration
    )
      reject("target project or authority binding changed");
    const project = await store.project(projectId);
    if (project.cwd !== expectedCwd) reject("registered project changed");
    if (await store.db.prepare("SELECT id FROM sessions WHERE id=?").get(fence.sessionId))
      reject("existing Host session cannot be overwritten");
    await store.assertAuthority(fence.sessionId, decision.authorityGeneration);
    await store.save(target.hostSession, {
      type: "authority-migration",
      migrationId: fence.migrationId,
      authorityGeneration: decision.authorityGeneration,
      converterVersion: converter.version,
      sourceDigest: fence.sourceDigest,
      targetDigest: stage.targetDigest,
    });
  };
}
