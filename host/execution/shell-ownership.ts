import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { HostStore } from "../store";
import type { ShellPhysicalIdentity } from "../../src/features/sessions/model/shellRun";
const PREFIX = "shell-physical-owner.v1:";
const INSTANCE = randomUUID();
const held = new Set<string>();
type Owner = {
  id: string;
  instance: string;
  cwd: string;
  kind: "task" | "session";
  ownerId: string;
  command: string;
  failure?: string;
  physicalIdentity?: ShellPhysicalIdentity;
  workspaceActivityId?: string;
};
const canonical = (cwd: string) =>
  process.platform === "win32" ? resolve(cwd).toLowerCase() : resolve(cwd);
async function rows(store: HostStore): Promise<Owner[]> {
  return (
    await store.db.prepare("SELECT value FROM metadata WHERE key GLOB ?").all(`${PREFIX}*`)
  ).map((row) => {
    const value = JSON.parse(String(row.value)) as Owner;
    if (
      !value?.id ||
      !value.instance ||
      !value.cwd ||
      !value.ownerId ||
      !["task", "session"].includes(value.kind)
    )
      throw new Error("Shell physical ownership cannot be verified.");
    return value;
  });
}
export async function assertShellOwnershipAvailable(store: HostStore, cwd: string): Promise<void> {
  const original = (await rows(store)).find(
    (owner) =>
      owner.cwd === canonical(cwd) &&
      (owner.failure || held.has(owner.id) || owner.instance !== INSTANCE),
  );
  if (original)
    throw new Error(
      `Command tree retirement is unverified (${original.kind} ${original.ownerId}, operation ${original.id}). Inspect Host diagnostics before retrying.`,
    );
}
export async function hasShellPhysicalOwner(
  store: HostStore,
  kind: Owner["kind"],
  ownerId: string,
): Promise<boolean> {
  return (await rows(store)).some((owner) => owner.kind === kind && owner.ownerId === ownerId);
}
/** Persist before spawn. Unknown owners survive task edits, deletion and Host restart. */
export async function reserveShellOwnership(
  store: HostStore,
  cwd: string,
  kind: Owner["kind"],
  ownerId: string,
  command: string,
  workspaceActivityId?: string,
) {
  let owner: Owner = {
    id: randomUUID(),
    instance: INSTANCE,
    cwd: canonical(cwd),
    kind,
    ownerId,
    command,
    ...(workspaceActivityId ? { workspaceActivityId } : {}),
  };
  let raw = JSON.stringify(owner);
  await store.transaction(async () => {
    await assertShellOwnershipAvailable(store, cwd);
    await store.db
      .prepare("INSERT INTO metadata(key,value) VALUES (?,?)")
      .run(PREFIX + owner.id, raw);
  });
  return {
    id: owner.id,
    async observe(physicalIdentity: ShellPhysicalIdentity): Promise<void> {
      if (
        owner.physicalIdentity &&
        (owner.physicalIdentity.pid !== physicalIdentity.pid ||
          owner.physicalIdentity.spawnObservedAt !== physicalIdentity.spawnObservedAt)
      )
        throw new Error("The original shell process identity changed.");
      const nextOwner = { ...owner, physicalIdentity };
      const next = JSON.stringify(nextOwner);
      const result = await store.db
        .prepare("UPDATE metadata SET value=? WHERE key=? AND value=?")
        .run(next, PREFIX + owner.id, raw);
      if (result.changes !== 1) {
        held.add(owner.id);
        throw new Error("The original shell ownership record changed.");
      }
      owner = nextOwner;
      raw = next;
    },
    async unknown(message: string): Promise<void> {
      held.add(owner.id);
      const next = JSON.stringify({ ...owner, failure: message });
      const result = await store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE metadata.value=?",
        )
        .run(PREFIX + owner.id, next, raw);
      if (result.changes !== 1) throw new Error("The original shell ownership record changed.");
      raw = next;
    },
    async complete(): Promise<void> {
      if (held.has(owner.id)) throw new Error("Command tree retirement remains unverified.");
      try {
        const result = await store.db
          .prepare("DELETE FROM metadata WHERE key=? AND value=?")
          .run(PREFIX + owner.id, raw);
        if (result.changes !== 1) throw new Error("The original shell ownership record changed.");
      } catch (error) {
        held.add(owner.id);
        throw error;
      }
    },
  };
}
