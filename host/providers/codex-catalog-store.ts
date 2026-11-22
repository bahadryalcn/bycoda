import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CatalogModelSchema } from "../../src/shared/model/host-contracts/models";
import type { AgentModel } from "../../src/shared/model/agentModel";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

const MAX_BYTES = 1024 * 1024;
const MAX_PROJECTS = 32;
const snapshotSchema = z.array(
  z.tuple([z.string(), z.array(CatalogModelSchema.extend({ harness: z.literal("codex") }))]),
);

/**
 * A successful snapshot is reusable only while the Host default profile's
 * credential file still refers to the same revision. Profiles with no file
 * evidence can still discover models, but cannot restore a disk snapshot.
 */
export async function codexCatalogIdentity(): Promise<string | null> {
  if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.CODEX_ACCESS_TOKEN)
    return null;
  const path = resolve(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
  const file = await stat(path, { bigint: true }).catch(() => null);
  if (!file?.isFile()) return null;
  return createHash("sha256")
    .update(JSON.stringify([path, String(file.ino), String(file.mtimeNs), String(file.ctimeNs)]))
    .digest("hex");
}

export class CodexCatalogStore {
  private readonly entries;
  private writes = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly environmentId: string,
  ) {
    this.entries = stat(path)
      .then(async (file) => {
        if (!file.isFile() || file.size > MAX_BYTES) return new Map<string, AgentModel[]>();
        const state = await readStateFile(path, (text) => snapshotSchema.parse(JSON.parse(text)), {
          quarantine: false,
        });
        return new Map<string, AgentModel[]>(state.value);
      })
      .catch(() => new Map<string, AgentModel[]>());
  }

  private key(cwd: string, identity: string): string {
    return JSON.stringify([this.environmentId, identity, cwd]);
  }

  async read(cwd: string, identity: string): Promise<AgentModel[] | undefined> {
    return (await this.entries).get(this.key(cwd, identity));
  }

  write(cwd: string, identity: string, models: AgentModel[]): Promise<void> {
    const update = this.writes.then(async () => {
      const entries = await this.entries;
      const key = this.key(cwd, identity);
      if (JSON.stringify(entries.get(key)) === JSON.stringify(models)) return;
      const next = new Map(entries);
      next.delete(key);
      next.set(key, models);
      let text = JSON.stringify([...next]);
      while (next.size > MAX_PROJECTS || Buffer.byteLength(text) > MAX_BYTES) {
        next.delete(next.keys().next().value!);
        text = JSON.stringify([...next]);
      }
      await writeFileAtomic(this.path, text);
      entries.clear();
      for (const [entry, value] of next) entries.set(entry, value);
    });
    this.writes = update.catch(() => {});
    return update;
  }
}
