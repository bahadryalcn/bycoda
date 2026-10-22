import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { HostStore } from "./store";

export const MCP_GROUPS = ["conversation", "runtime-logs", "social"] as const;
export type McpGroup = (typeof MCP_GROUPS)[number];
export type McpGrant = {
  id: string;
  name: string;
  projectId: string;
  scopes: Partial<Record<McpGroup, ("read" | "write")[]>>;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
};
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Only the owner RPC can mint grants. Secrets are returned once, never persisted. */
export class McpTokens {
  constructor(
    private readonly store: HostStore,
    private readonly now = Date.now,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, value TEXT NOT NULL
    )`);
  }

  create(input: Record<string, unknown>): McpGrant & { token: string } {
    if (
      Object.keys(input).some((key) => !["name", "projectId", "scopes", "expiresAt"].includes(key))
    )
      throw new Error("Unknown token field.");
    const { name, projectId, scopes, expiresAt } = input;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 200 ||
      typeof projectId !== "string" ||
      !Number.isSafeInteger(expiresAt) ||
      (expiresAt as number) <= this.now() ||
      (expiresAt as number) > this.now() + 366 * 86400_000 ||
      !scopes ||
      typeof scopes !== "object" ||
      Array.isArray(scopes)
    )
      throw new Error("A name, project, explicit scopes and expiry within one year are required.");
    this.store.project(projectId);
    const entries = Object.entries(scopes);
    if (
      !entries.length ||
      entries.some(
        ([group, modes]) =>
          !(MCP_GROUPS as readonly string[]).includes(group) ||
          !Array.isArray(modes) ||
          !modes.length ||
          modes.length > 2 ||
          new Set(modes).size !== modes.length ||
          modes.some((mode) => mode !== "read" && mode !== "write"),
      )
    )
      throw new Error("Invalid MCP scopes.");
    const grant: McpGrant = {
      id: randomUUID(),
      name: name.trim(),
      projectId,
      scopes: structuredClone(scopes) as McpGrant["scopes"],
      createdAt: this.now(),
      expiresAt: expiresAt as number,
    };
    const token = randomBytes(32).toString("base64url");
    this.store.db
      .prepare("INSERT INTO mcp_tokens VALUES (?,?,?)")
      .run(grant.id, tokenDigest(token), JSON.stringify(grant));
    return { ...grant, token };
  }

  list(): McpGrant[] {
    return this.store.db
      .prepare("SELECT value FROM mcp_tokens ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(String(row.value)) as McpGrant);
  }

  revoke(id: unknown): { revoked: boolean } {
    if (typeof id !== "string") throw new Error("Token ID required.");
    const row = this.store.db.prepare("SELECT value FROM mcp_tokens WHERE id=?").get(id);
    if (!row) return { revoked: false };
    const grant = JSON.parse(String(row.value)) as McpGrant;
    if (!grant.revokedAt) {
      grant.revokedAt = this.now();
      this.store.db
        .prepare("UPDATE mcp_tokens SET value=? WHERE id=?")
        .run(JSON.stringify(grant), id);
    }
    return { revoked: true };
  }

  get(token: string): McpGrant | undefined {
    const row = this.store.db
      .prepare("SELECT value FROM mcp_tokens WHERE hash=?")
      .get(tokenDigest(token));
    if (!row) return;
    const grant = JSON.parse(String(row.value)) as McpGrant;
    if (grant.revokedAt !== undefined || grant.expiresAt <= this.now()) return;
    try {
      this.store.project(grant.projectId);
    } catch {
      return;
    }
    return grant;
  }
}
