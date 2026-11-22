import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join, normalize } from "node:path";
import { osSecretValues, type SecretValueStore } from "../../secrets/secret-store";
import type { InventoryDefinition } from "./inventory";

type Credential = { revision: string; values: Record<string, string>; scope?: "user" | "project" };
type Kind = InventoryDefinition["kind"];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.\x2d^_`|~0-9A-Za-z]+$/;
const RESERVED_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "expect",
  "host",
  "keep-alive",
  "mcp-protocol-version",
  "mcp-session-id",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function projectMcpAccount(cwd: string): string {
  if (!isAbsolute(cwd)) throw new Error("An absolute project folder is required.");
  const normalized = normalize(cwd);
  const path =
    process.platform === "win32" ? normalized.replaceAll("\\", "/").toLowerCase() : normalized;
  return `mcp-project:${createHash("sha256").update(path.replace(/\/+$/, "")).digest("hex")}`;
}

function credentialRef(cwd: string | undefined, def: InventoryDefinition): string {
  const identity = [
    cwd ? projectMcpAccount(cwd) : "machine",
    def.name,
    def.source,
    def.kind,
    def.command,
    def.args,
    def.url,
  ];
  return `mcp-project:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function validate(kind: Kind, values: unknown): Record<string, string> {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("MCP credentials must be a map of names to values.");
  const entries = Object.entries(values);
  if (!entries.length || entries.length > 32) throw new Error("Enter between 1 and 32 values.");
  const seen = new Set<string>();
  return Object.fromEntries(
    entries.map(([key, value]) => {
      const header = kind === "http";
      const name = header || process.platform === "win32" ? key.toLowerCase() : key;
      if (
        key.length > 128 ||
        !(header ? HEADER_NAME.test(key) && !RESERVED_HEADERS.has(name) : ENV_NAME.test(key)) ||
        seen.has(name) ||
        typeof value !== "string" ||
        !value.length ||
        value.length > 8192 ||
        ["\0", "\r", "\n"].some((character) => value.includes(character)) ||
        (header && /[^\t\x20-\x7e\x80-\xff]/.test(value))
      )
        throw new Error("Invalid MCP credential name or value.");
      seen.add(name);
      return [header ? name : key, value];
    }),
  );
}

function permitsPrivateHeaders(url: string): boolean {
  const endpoint = URL.parse(url);
  if (!endpoint) return false;
  if (endpoint.username || endpoint.password) return false;
  if (endpoint.protocol === "https:") return true;
  const host = endpoint.hostname;
  return (
    endpoint.protocol === "http:" &&
    (host === "[::1]" || (isIP(host) === 4 && host.startsWith("127.")))
  );
}

export class ProjectMcpCredentials {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly vault: SecretValueStore) {}

  async get(cwd: string | undefined, def: InventoryDefinition): Promise<Credential | undefined> {
    await this.writing.catch(() => undefined);
    const raw = await this.vault.get(credentialRef(cwd, def));
    if (raw === undefined) return undefined;
    try {
      const entry = JSON.parse(raw) as Credential;
      if (typeof entry.revision !== "string" || !/^[a-f0-9-]{36}$/.test(entry.revision))
        throw new Error();
      return {
        revision: entry.revision,
        values: validate(def.kind, entry.values),
        scope: cwd ? "project" : "user",
      };
    } catch {
      throw new Error("Stored MCP project credentials are invalid.");
    }
  }

  async set(cwd: string | undefined, def: InventoryDefinition, values: unknown): Promise<void> {
    if (def.kind === "http" && (!def.url || !permitsPrivateHeaders(def.url)))
      throw new Error("Private MCP headers require HTTPS or a loopback IP.");
    const entry = { revision: randomUUID(), values: validate(def.kind, values) };
    const ref = credentialRef(cwd, def);
    await this.write(() => this.vault.set(ref, JSON.stringify(entry)));
  }

  clear(cwd: string | undefined, def: InventoryDefinition): Promise<void> {
    const ref = credentialRef(cwd, def);
    return this.write(() => this.vault.delete(ref));
  }

  private write(operation: () => Promise<void>): Promise<void> {
    this.writing = this.writing.catch(() => undefined).then(operation);
    return this.writing;
  }
}

export function osProjectMcpCredentialValues(dataDir: string): SecretValueStore {
  const directory = join(dataDir, "mcp-hub", "project-credentials");
  const namespace = createHash("sha256").update(dataDir).digest("hex").slice(0, 12);
  const store = osSecretValues(directory, `mcp-project-${namespace}`);
  const existing = async () => {
    try {
      await stat(join(directory, "vault", "tokens.enc"));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new Error("MCP project credential vault unavailable.");
    }
  };
  return {
    get: async (ref) => ((await existing()) ? store.get(ref) : undefined),
    set: store.set,
    delete: async (ref) => {
      if (await existing()) await store.delete(ref);
    },
  };
}
