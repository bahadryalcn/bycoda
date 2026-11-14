import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { HostStore } from "../store";

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
const MAX_LIFETIME_MS = 366 * 86400_000;

function validScopes(scopes: unknown): scopes is McpGrant["scopes"] {
  if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) return false;
  const entries = Object.entries(scopes);
  return (
    entries.length > 0 &&
    entries.every(
      ([group, modes]) =>
        (MCP_GROUPS as readonly string[]).includes(group) &&
        Array.isArray(modes) &&
        modes.length > 0 &&
        modes.length <= 2 &&
        new Set(modes).size === modes.length &&
        modes.every((mode) => mode === "read" || mode === "write"),
    )
  );
}

function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Decode only grant fields; corrupt persistence never becomes authorization or secret disclosure. */
function storedGrant(raw: unknown, id: unknown): McpGrant {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(String(raw));
  } catch {
    throw new Error("Stored MCP grant is invalid.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id !== id ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 200 ||
    typeof value.projectId !== "string" ||
    !value.projectId ||
    !validScopes(value.scopes) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.expiresAt) ||
    value.expiresAt <= value.createdAt ||
    value.expiresAt > value.createdAt + MAX_LIFETIME_MS ||
    (value.revokedAt !== undefined && !timestamp(value.revokedAt))
  )
    throw new Error("Stored MCP grant is invalid.");
  return {
    id: value.id,
    name: value.name,
    projectId: value.projectId,
    scopes: value.scopes,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    ...(value.revokedAt !== undefined ? { revokedAt: value.revokedAt } : {}),
  };
}
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Only the owner RPC can mint grants. Secrets are returned once, never persisted. */
export class McpTokens {
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly now = Date.now,
  ) {
    this.ready = store.ready.then(
      async () =>
        await store.db.exec(`CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, value TEXT NOT NULL
    )`),
    );
  }

  async create(input: Record<string, unknown>): Promise<Awaited<McpGrant & { token: string }>> {
    await this.ready;
    return await this.store.db.scope(async () => {
      if (
        Object.keys(input).some(
          (key) => !["name", "projectId", "scopes", "expiresAt"].includes(key),
        )
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
        (expiresAt as number) > this.now() + MAX_LIFETIME_MS ||
        !scopes ||
        typeof scopes !== "object" ||
        Array.isArray(scopes)
      )
        throw new Error(
          "A name, project, explicit scopes and expiry within one year are required.",
        );
      await this.store.project(projectId);
      const now = this.now();
      if ((expiresAt as number) <= now || (expiresAt as number) > now + MAX_LIFETIME_MS)
        throw new Error("Expiry must remain within one year at issuance.");
      if (!validScopes(scopes)) throw new Error("Invalid MCP scopes.");
      const grant: McpGrant = {
        id: randomUUID(),
        name: name.trim(),
        projectId,
        scopes: structuredClone(scopes) as McpGrant["scopes"],
        createdAt: now,
        expiresAt: expiresAt as number,
      };
      const token = randomBytes(32).toString("base64url");
      await this.store.db
        .prepare("INSERT INTO mcp_tokens VALUES (?,?,?)")
        .run(grant.id, tokenDigest(token), JSON.stringify(grant));
      return { ...grant, token };
    });
  }

  async list(): Promise<Awaited<McpGrant[]>> {
    await this.ready;
    return await this.store.db.scope(async () => {
      return (
        await this.store.db.prepare("SELECT id,value FROM mcp_tokens ORDER BY rowid DESC").all()
      ).map((row) => storedGrant(row.value, row.id));
    });
  }

  async revoke(id: unknown): Promise<Awaited<{ revoked: boolean }>> {
    await this.ready;
    return await this.store.db.scope(async () => {
      if (typeof id !== "string") throw new Error("Token ID required.");
      const row = await this.store.db.prepare("SELECT id,value FROM mcp_tokens WHERE id=?").get(id);
      if (!row) return { revoked: false };
      const grant = storedGrant(row.value, row.id);
      if (grant.revokedAt === undefined) {
        grant.revokedAt = this.now();
        await this.store.db
          .prepare("UPDATE mcp_tokens SET value=? WHERE id=?")
          .run(JSON.stringify(grant), id);
      }
      return { revoked: true };
    });
  }

  async get(token: string): Promise<Awaited<McpGrant | undefined>> {
    await this.ready;
    return await this.store.db.scope(async () => {
      const digest = tokenDigest(token);
      const row = await this.store.db
        .prepare("SELECT id,value FROM mcp_tokens WHERE hash=?")
        .get(digest);
      if (!row) return;
      let grant: McpGrant;
      try {
        grant = storedGrant(row.value, row.id);
      } catch {
        return;
      }
      if (grant.revokedAt !== undefined || grant.expiresAt <= this.now()) return;
      try {
        await this.store.project(grant.projectId);
      } catch {
        return;
      }
      const current = await this.store.db
        .prepare("SELECT id,value FROM mcp_tokens WHERE hash=?")
        .get(digest);
      if (
        !current ||
        current.id !== row.id ||
        current.value !== row.value ||
        grant.expiresAt <= this.now()
      )
        return;
      return grant;
    });
  }
}
