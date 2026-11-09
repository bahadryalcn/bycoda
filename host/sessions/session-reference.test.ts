import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { assertSessionReference } from "./session-reference";
import {
  hostAuthorityDecisionDigestInput,
  type HostAuthorityDecision,
  type NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";
import {
  SessionsGetParamsSchema,
  type SessionReferenceLocator,
} from "../../src/shared/model/host-contracts/session-reads";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const native: SessionReferenceLocator = {
  kind: "native",
  sourceStoreId: "native-store",
  sourceProfileId: "profile",
  sessionId: "session",
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-session-reference-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  const localReference = vi.fn(async (): Promise<SessionReferenceLocator | undefined> => native);
  const ports = { environmentId: store.environmentId, database: store.db, localReference };
  const host: SessionReferenceLocator = {
    kind: "host",
    environmentId: store.environmentId,
    sessionId: "session",
  };
  const assert = (reference: unknown, id = "session") =>
    assertSessionReference(ports, id, reference);
  const migrate = async () => {
    localReference.mockResolvedValue(host);
    const fence: NativeFenceEvidence = {
      protocol: 2,
      environmentId: store.environmentId,
      sessionId: "session",
      migrationId: "migration",
      sourceStoreId: "native-store",
      sourceProfileId: "profile",
      generation: 1,
      sourceRevision: 1,
      sourceDigest: hash("{}"),
      snapshotEncoding: "source-json-utf8/v1",
      minWriterProtocol: 2,
      quiescent: true,
      unknownReservations: false,
      writerInventoryVerified: true,
      unsupportedWriters: false,
      evidenceDigest: "a".repeat(64),
    };
    const decision: HostAuthorityDecision = {
      protocol: 2,
      environmentId: store.environmentId,
      sessionId: "session",
      migrationId: "migration",
      sourceStoreId: "native-store",
      sourceProfileId: "profile",
      sourceGeneration: 1,
      authorityGeneration: 1,
      sourceRevision: 1,
      sourceDigest: fence.sourceDigest,
      evidenceDigest: fence.evidenceDigest,
      minWriterProtocol: 2,
      receiptId: "receipt",
      phase: "host-active",
      targetDigest: hash("{}"),
      committedAt: 1,
      decisionDigest: "",
    };
    decision.decisionDigest = hash(hostAuthorityDecisionDigestInput(decision));
    await store.db.exec(`CREATE TABLE host_authority_journal (
      migration_id TEXT PRIMARY KEY,environment_id TEXT,session_id TEXT,generation INTEGER,phase TEXT,
      evidence TEXT,decision TEXT,target_digest TEXT,source_json TEXT,target_json TEXT,converter_version TEXT)`);
    await store.db
      .prepare("INSERT INTO host_authority_heads VALUES(?,?,1,'migration','host-active')")
      .run(store.environmentId, "session");
    await store.db
      .prepare(
        "INSERT INTO host_authority_journal VALUES(?,?,?,1,'host-active',?,?,?,'{}','{}','fixture')",
      )
      .run(
        "migration",
        store.environmentId,
        "session",
        JSON.stringify(fence),
        JSON.stringify(decision),
        decision.targetDigest,
      );
  };
  return { assert, store, host, localReference, migrate };
}

it("accepts only well-formed optional locator input on sessions.get", () => {
  expect(
    SessionsGetParamsSchema.parse({ sessionId: "session", reference: native }).reference,
  ).toEqual(native);
  for (const reference of [
    {},
    { ...native, sourceStoreId: "" },
    { ...native, extra: true },
    { kind: "remote", sessionId: "session" },
  ])
    expect(SessionsGetParamsSchema.safeParse({ sessionId: "session", reference }).success).toBe(
      false,
    );
});
it("accepts the exact current Native locator without consulting migrations", async () => {
  const f = await fixture();
  await expect(f.assert(native)).resolves.toBeUndefined();
});
it.each(["sourceStoreId", "sourceProfileId", "sessionId"])(
  "rejects a different Native %s",
  async (key) => {
    const f = await fixture();
    await expect(f.assert({ ...native, [key]: "other" })).rejects.toThrow("Reference unavailable");
  },
);
it("rejects malformed input and mismatched session IDs before identity lookup", async () => {
  const f = await fixture();
  await expect(f.assert({ ...native, extra: true })).rejects.toThrow("Reference unavailable");
  await expect(f.assert(native, "other")).rejects.toThrow("Reference unavailable");
  expect(f.localReference).not.toHaveBeenCalled();
});
it("accepts only this Host's Host-owned session", async () => {
  const f = await fixture();
  await expect(f.assert(f.host)).rejects.toThrow("Reference unavailable");
  f.localReference.mockResolvedValue(f.host);
  await expect(f.assert(f.host)).resolves.toBeUndefined();
  await expect(f.assert({ ...f.host, environmentId: "other" })).rejects.toThrow(
    "Reference unavailable",
  );
  f.localReference.mockResolvedValue({ ...f.host, environmentId: "other" });
  await expect(f.assert(f.host)).rejects.toThrow("Reference unavailable");
});
it("does not substitute another session returned by identity lookup", async () => {
  const f = await fixture();
  f.localReference.mockResolvedValue({ ...native, sessionId: "other" });
  await expect(f.assert(native)).rejects.toThrow("Reference unavailable");
  f.localReference.mockResolvedValue(undefined);
  await expect(f.assert(native)).rejects.toThrow("Reference unavailable");
});
it("follows an existing verified committed migration without writing", async () => {
  const f = await fixture();
  await f.migrate();
  const before = await f.store.db.prepare("SELECT * FROM host_authority_journal").all();
  await expect(f.assert(native)).resolves.toBeUndefined();
  expect(await f.store.db.prepare("SELECT * FROM host_authority_journal").all()).toEqual(before);
});
it.each([
  "UPDATE host_authority_heads SET phase='native-fenced'",
  "UPDATE host_authority_heads SET generation=2",
  "UPDATE host_authority_heads SET migration_id='other'",
  "UPDATE host_authority_journal SET phase='prepared'",
  "UPDATE host_authority_journal SET decision=NULL",
  "UPDATE host_authority_journal SET target_json='changed'",
  "UPDATE host_authority_journal SET source_json='changed'",
  "UPDATE host_authority_journal SET decision=json_set(decision,'$.sourceStoreId','other')",
  "UPDATE host_authority_journal SET evidence=json_set(evidence,'$.sourceProfileId','other')",
])("rejects incomplete, replaced or corrupt migration evidence: %s", async (sql) => {
  const f = await fixture();
  await f.migrate();
  await f.store.db.exec(sql);
  await expect(f.assert(native)).rejects.toThrow("Reference unavailable");
});
