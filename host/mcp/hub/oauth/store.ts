import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SecretValueStore } from "../../../secrets/secret-store";
import { readStateFile, writeFileAtomic } from "../../../storage/atomic-write";
import type { AuthServer } from "./discovery";
import type { OAuthClient, OAuthTokens } from "./tokens";

/** Secret material: only ever inside the encrypted vault, never in the index, logs or RPC. */
export type StoredCredential = {
  version: 1;
  resource: string;
  server: AuthServer;
  client: OAuthClient;
  tokens: OAuthTokens;
};

/** Non-secret metadata so status and publication never touch the vault. */
export type OAuthIndexEntry = {
  id: string;
  name: string;
  url: string;
  account: string;
  state: "signed-in" | "expired" | "error" | "none";
  expiresAt?: number;
  refreshable?: boolean;
  /** Fixed code, never upstream text. */
  error?: string;
};

export const DEFAULT_ACCOUNT = "owner";
const MAX_ENTRIES = 256;

export const credentialId = (name: string, url: string, account = DEFAULT_ACCOUNT) =>
  createHash("sha256")
    .update(JSON.stringify([name, url, account]))
    .digest("hex")
    .slice(0, 32);

const vaultRef = (id: string) => `mcp-oauth:${id}`;

function parseIndex(text: string): OAuthIndexEntry[] {
  const parsed: unknown = JSON.parse(text);
  const entries = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) throw new Error("Invalid MCP sign-in index.");
  return entries.filter(
    (entry): entry is OAuthIndexEntry =>
      !!entry &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      typeof entry.url === "string" &&
      ["signed-in", "expired", "error", "none"].includes(entry.state),
  );
}

function parseCredential(text: string): StoredCredential {
  const value = JSON.parse(text) as StoredCredential;
  if (
    value?.version !== 1 ||
    typeof value.resource !== "string" ||
    typeof value.server?.tokenEndpoint !== "string" ||
    typeof value.client?.clientId !== "string" ||
    typeof value.tokens?.accessToken !== "string" ||
    typeof value.tokens.expiresAt !== "number"
  )
    throw new Error("Invalid MCP sign-in credential.");
  return value;
}

/** Index in `<dataDir>/mcp-hub/oauth/index.json`; credentials in the OS-backed secrets vault. */
export class OAuthStore {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  private cache?: OAuthIndexEntry[];

  constructor(
    dataDir: string,
    private readonly values: SecretValueStore,
  ) {
    this.file = join(dataDir, "mcp-hub", "oauth", "index.json");
  }

  private locked<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => undefined).then(task);
    this.queue = run;
    return run;
  }

  private async load(): Promise<OAuthIndexEntry[]> {
    if (this.cache) return this.cache;
    const result = await readStateFile(this.file, parseIndex);
    // A corrupt index reads as signed out; the evidence copy stays beside it.
    this.cache = result.status === "ok" ? result.value : [];
    return this.cache;
  }

  private async save(entries: OAuthIndexEntry[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.file, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
    this.cache = entries;
  }

  entries(): Promise<OAuthIndexEntry[]> {
    return this.locked(() => this.load());
  }

  async entry(id: string): Promise<OAuthIndexEntry | undefined> {
    return (await this.entries()).find((item) => item.id === id);
  }

  async credential(id: string): Promise<StoredCredential | undefined> {
    const raw = await this.values.get(vaultRef(id));
    if (!raw) return undefined;
    try {
      return parseCredential(raw);
    } catch {
      return undefined;
    }
  }

  /** Vault first, then the index, so a listed entry always has a credential behind it. */
  async put(entry: OAuthIndexEntry, credential: StoredCredential): Promise<void> {
    await this.locked(async () => {
      await this.values.set(vaultRef(entry.id), JSON.stringify(credential));
      const others = (await this.load()).filter((item) => item.id !== entry.id);
      if (others.length >= MAX_ENTRIES) throw new Error("Too many MCP sign-ins.");
      await this.save([...others, entry]);
    });
  }

  async mark(entry: OAuthIndexEntry): Promise<void> {
    await this.locked(async () => {
      const others = (await this.load()).filter((item) => item.id !== entry.id);
      await this.save([...others, entry]);
    });
  }

  async remove(id: string): Promise<void> {
    await this.locked(async () => {
      await this.values.delete(vaultRef(id));
      await this.save((await this.load()).filter((item) => item.id !== id));
    });
  }

  async signOutProject(entry: OAuthIndexEntry): Promise<void> {
    await this.locked(async () => {
      const entries = await this.load();
      const others = entries.filter((item) => item.id !== entry.id);
      if (others.length >= MAX_ENTRIES) throw new Error("Too many MCP sign-ins.");
      if (entries.some((item) => item.id === entry.id && item.state !== "none"))
        await this.values.delete(vaultRef(entry.id));
      await this.save([...others, entry]);
    });
  }
}
