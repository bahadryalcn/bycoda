import type { HostStore } from "../store";
import type { WorkspaceBootstrapStatus } from "./workspace-contracts";

/** Durable identity receipts; never expire accepted requests or infer process death. */
export class WorkspaceBootstrapReceipts {
  private readonly ready: Promise<void>;
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() =>
      store.db.scope(async () => {
        await store.db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_bootstrap_receipts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, fingerprint TEXT NOT NULL, settled INTEGER NOT NULL, value TEXT NOT NULL, command_evidence TEXT);
        CREATE INDEX IF NOT EXISTS workspace_bootstrap_identity_idx ON workspace_bootstrap_receipts(workspace_id, fingerprint);
        CREATE INDEX IF NOT EXISTS workspace_bootstrap_active_idx ON workspace_bootstrap_receipts(workspace_id, settled);
        CREATE TABLE IF NOT EXISTS workspace_bootstrap_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, operation_id TEXT NOT NULL);
      `);
      }),
    );
  }
  async request(key: string) {
    await this.ready;
    const row = await this.store.db
      .prepare(
        "SELECT fingerprint, operation_id FROM workspace_bootstrap_requests WHERE request_key=?",
      )
      .get(key);
    return row ? { fingerprint: String(row.fingerprint), id: String(row.operation_id) } : undefined;
  }
  async status(
    id: string,
  ): Promise<{ status: WorkspaceBootstrapStatus; settled: boolean } | undefined> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value, settled FROM workspace_bootstrap_receipts WHERE id=?")
      .get(id);
    return row
      ? {
          status: JSON.parse(String(row.value)) as WorkspaceBootstrapStatus,
          settled: row.settled === 1,
        }
      : undefined;
  }
  async identity(workspaceId: string, fingerprint: string) {
    await this.ready;
    const row = await this.store.db
      .prepare(
        "SELECT id FROM workspace_bootstrap_receipts WHERE workspace_id=? AND fingerprint=? AND json_extract(value,'$.state') NOT IN ('failed','cancelled') ORDER BY rowid DESC LIMIT 1",
      )
      .get(workspaceId, fingerprint);
    return row ? String(row.id) : undefined;
  }
  async held(workspaceId: string): Promise<boolean> {
    await this.ready;
    return Boolean(
      await this.store.db
        .prepare(
          "SELECT 1 FROM workspace_bootstrap_receipts WHERE workspace_id=? AND settled=0 LIMIT 1",
        )
        .get(workspaceId),
    );
  }
  async admit(status: WorkspaceBootstrapStatus, requestKey: string) {
    await this.ready;
    await this.store.transaction(async () => {
      // Admission is also fenced in storage for concurrent service instances.
      if (await this.held(status.workspaceId))
        throw new Error("Workspace preparation still has an original unresolved owner.");
      await this.store.db
        .prepare(
          "INSERT INTO workspace_bootstrap_receipts (id, workspace_id, fingerprint, settled, value) VALUES (?, ?, ?, 0, ?)",
        )
        .run(status.id, status.workspaceId, status.lockfileFingerprint, JSON.stringify(status));
      await this.link(requestKey, status.lockfileFingerprint, status.id);
    });
  }
  async link(key: string, fingerprint: string, id: string) {
    await this.ready;
    await this.store.db
      .prepare("INSERT INTO workspace_bootstrap_requests VALUES (?, ?, ?)")
      .run(key, fingerprint, id);
  }
  async commandEvidence(id: string, evidence: { command: string; args: string[]; cwd: string }) {
    await this.ready;
    await this.store.db
      .prepare(
        "UPDATE workspace_bootstrap_receipts SET command_evidence=? WHERE id=? AND settled=0",
      )
      .run(JSON.stringify(evidence), id);
  }
  async finish(status: WorkspaceBootstrapStatus, settled: boolean) {
    await this.ready;
    await this.store.db
      .prepare(
        "UPDATE workspace_bootstrap_receipts SET value=?, settled=? WHERE id=? AND workspace_id=? AND fingerprint=?",
      )
      .run(
        JSON.stringify(status),
        settled ? 1 : 0,
        status.id,
        status.workspaceId,
        status.lockfileFingerprint,
      );
  }
}
