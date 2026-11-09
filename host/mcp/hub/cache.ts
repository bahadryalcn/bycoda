import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readStateFile, writeFileAtomic } from "../../storage/atomic-write";

/** Listings captured from one real start, replayed while the child is down. */
export type HubCache = {
  protocolVersion: string;
  initialize: Record<string, unknown>;
  tools: unknown[];
  lists: Record<string, unknown>;
  savedAt: number;
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const isCache = (value: unknown): value is HubCache => {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<HubCache>;
  return (
    typeof cache.protocolVersion === "string" &&
    !!cache.initialize &&
    typeof cache.initialize === "object" &&
    Array.isArray(cache.tools) &&
    !!cache.lists &&
    typeof cache.lists === "object"
  );
};

/** One file per server name under `<dataDir>/mcp-hub/`, written atomically. */
export class HubCacheStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, "mcp-hub");
  }

  private file(name: string): string {
    if (!NAME.test(name)) throw new Error("Invalid MCP server name.");
    return join(this.dir, `${name}.json`);
  }

  async read(name: string): Promise<HubCache | undefined> {
    try {
      const result = await readStateFile(this.file(name), (text) => JSON.parse(text) as unknown, {
        quarantine: false,
      });
      return result.status === "ok" && isCache(result.value) ? result.value : undefined;
    } catch {
      return undefined;
    }
  }

  async write(name: string, cache: HubCache): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.file(name), JSON.stringify(cache, null, 2));
  }
}
