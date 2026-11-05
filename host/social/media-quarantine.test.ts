import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { SocialMediaCustody } from "./media-custody";
import { SocialMediaQuarantine } from "./media-quarantine";

const DAY_MS = 86_400_000;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function createGate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { pause: () => opened, release: () => open() };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture(pause?: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "social-quarantine-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  await store.db
    .exec(`CREATE TABLE social_records(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id));
    CREATE TABLE social_jobs(id TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE social_jobs_cold(id TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE social_programs(id TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE social_occurrences(id TEXT PRIMARY KEY,value TEXT);`);
  const custody = new SocialMediaCustody(store, directory, pause);
  await custody.initialize();
  if (!pause) await custody.reconciled();
  const quarantine = new SocialMediaQuarantine(store, directory, custody);
  cleanup.push(async () => {
    await custody.reconciled().catch(() => undefined);
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store, custody, quarantine };
}

/** Registers an owned upload, releases its owner claim, and ages the file past retention. */
async function unownedUpload(f: Awaited<ReturnType<typeof fixture>>) {
  const id = randomUUID();
  const scope = { accountId: "owner:a" };
  await f.custody.registerManagedUpload(scope, id, Buffer.from("unowned"));
  const path = join(f.directory, "media", id);
  const old = new Date(Date.now() - 8 * DAY_MS);
  await utimes(path, old, old);
  return { id, scope, path };
}

const stateOf = async (f: Awaited<ReturnType<typeof fixture>>, id: string) =>
  (await f.store.db.prepare("SELECT state FROM social_media_files WHERE id=?").get(id))!.state;

it("sweep waits for the reference rebuild before retiring an unowned upload", async () => {
  const gate = createGate();
  const f = await fixture(gate.pause);
  cleanup.push(async () => gate.release());
  const { id } = await unownedUpload(f);
  // Only a non-empty batch reaches the gate, so this row keeps the rebuild paused.
  await f.store.db
    .prepare("INSERT INTO social_jobs VALUES (?,?)")
    .run("plain", JSON.stringify({ id: "plain" }));
  await f.custody.initialize();

  let swept = false;
  const sweep = f.quarantine.sweep().then(() => {
    swept = true;
  });
  await flush();
  await flush();
  expect(swept).toBe(false);
  expect(await stateOf(f, id)).toBe("active");

  gate.release();
  await sweep;
  expect(await stateOf(f, id)).toBe("quarantined");
});

it("sweep skips the pass when the rebuild failed and keeps the upload", async () => {
  const f = await fixture(async () => {
    throw new Error("rebuild stopped");
  });
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { id, scope } = await unownedUpload(f);
  await f.store.db
    .prepare("INSERT INTO social_jobs VALUES (?,?)")
    .run("plain", JSON.stringify({ id: "plain" }));
  await f.custody.initialize();
  await expect(f.custody.reconciled()).rejects.toThrow("rebuild stopped");

  await expect(f.quarantine.sweep()).resolves.toBeUndefined();
  expect(await stateOf(f, id)).toBe("active");
  await expect(f.quarantine.quarantine(scope, id, 1)).rejects.toThrow("rebuild stopped");
  expect(await stateOf(f, id)).toBe("active");
  expect(errors).toHaveBeenCalled();
});

it("manual quarantine waits for the rebuild before checking owners", async () => {
  const gate = createGate();
  const f = await fixture(gate.pause);
  cleanup.push(async () => gate.release());
  const { id, scope } = await unownedUpload(f);
  await f.store.db
    .prepare("INSERT INTO social_jobs VALUES (?,?)")
    .run("plain", JSON.stringify({ id: "plain" }));
  await f.custody.initialize();
  // Release the upload owner first so only the rebuild gate decides the outcome.
  await f.custody.releaseLogicalClaim(
    scope,
    id,
    { ownerKind: "upload", ownerId: scope.accountId, claimId: id },
    1,
  );

  let settled = false;
  const request = f.quarantine.quarantine(scope, id, 2).then((status) => {
    settled = true;
    return status;
  });
  await flush();
  expect(settled).toBe(false);
  expect(await stateOf(f, id)).toBe("active");

  gate.release();
  await expect(request).resolves.toMatchObject({ state: "quarantined", activeClaims: 0 });
});
