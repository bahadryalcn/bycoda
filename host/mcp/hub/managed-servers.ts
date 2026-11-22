import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readStateFile, writeFileAtomic } from "../../storage/atomic-write";
import { projectMcpAccount } from "./project-credentials";

const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);
const revision = z.string().uuid();
const config = z.union([
  z.strictObject({
    url: z
      .string()
      .max(4096)
      .refine((value) => {
        const url = URL.parse(value);
        return (
          !!url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
        );
      }),
    type: z.literal("http").optional(),
  }),
  z.strictObject({
    command: z.string().trim().min(1).max(4096),
    args: z.array(z.string().max(8192)).max(128).optional(),
    type: z.literal("stdio").optional(),
  }),
]);
const entry = z.strictObject({ name, id: revision, revision, config, enabled: z.boolean() });
const entries = z
  .array(entry)
  .max(200)
  .refine((items) => new Set(items.map((item) => item.name)).size === items.length);
const operation = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("get"), name }),
  z.strictObject({ action: z.literal("add"), name, config }),
  z.strictObject({ action: z.literal("update"), name, revision, config }),
  z.strictObject({ action: z.literal("setEnabled"), name, revision, enabled: z.boolean() }),
  z.strictObject({ action: z.literal("remove"), name, revision }),
]);
export type ManagedMcpServer = z.infer<typeof entry>;

export class ManagedMcpServers {
  private writes = Promise.resolve();
  constructor(private readonly directory: string) {}

  private path(cwd?: string) {
    return join(
      this.directory,
      cwd ? projectMcpAccount(cwd).replace(":", "-") + ".json" : "global.json",
    );
  }

  async list(cwd?: string) {
    const result = await readStateFile(this.path(cwd), (text) => entries.parse(JSON.parse(text)), {
      quarantine: false,
    });
    if (result.status === "ok") return result.value;
    if (result.status === "missing") return [];
    throw new Error("The Hub server registry is unreadable.");
  }

  async call(input: unknown, cwd: string | undefined, authorize: () => Promise<void>) {
    const parsed = operation.safeParse(input);
    if (!parsed.success) throw new Error("Invalid Hub server configuration.");
    const change = parsed.data;
    const execute = async () => {
      const current = await this.list(cwd);
      const item = current.find((server) => server.name === change.name);
      if (change.action === "get") {
        if (!item) throw new Error("Hub server not found.");
        return item;
      }
      if (change.action === "add" ? !!item : item?.revision !== change.revision)
        throw new Error("The Hub server changed. Refresh and try again.");
      const next = current.filter((server) => server.name !== change.name);
      const saved =
        change.action === "remove"
          ? undefined
          : {
              name: change.name,
              id: item?.id ?? randomUUID(),
              revision: randomUUID(),
              config: change.action === "setEnabled" ? item!.config : change.config,
              enabled: change.action === "setEnabled" ? change.enabled : (item?.enabled ?? true),
            };
      if (saved) next.push(saved);
      const data = entries.safeParse(next);
      if (!data.success) throw new Error("Too many Hub servers in this scope.");
      const path = this.path(cwd);
      await mkdir(dirname(path), { recursive: true });
      await authorize();
      await writeFileAtomic(path, JSON.stringify(data.data, null, 2), { mode: 0o600 });
      return saved ?? { removed: true };
    };
    const request = this.writes.then(execute);
    this.writes = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }
}
