import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FILE_TTL_MS, MAX_SECRETS, SecretStore, type SecretValueStore } from "./secret-store";

const VALUE = "synthetic-secret-value-7f3a";
const dirs: string[] = [];
const stores: SecretStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function memoryValues() {
  const map = new Map<string, string>();
  const values: SecretValueStore = {
    async get(ref) {
      return map.get(ref);
    },
    async set(ref, value) {
      map.set(ref, value);
    },
    async delete(ref) {
      map.delete(ref);
    },
  };
  return { map, values };
}

function fixture(clock = { now: 1_000_000 }) {
  const directory = mkdtempSync(join(tmpdir(), "secret-store-test-"));
  dirs.push(directory);
  const { map, values } = memoryValues();
  const restricted: string[] = [];
  const open = (dir = directory) => {
    const store = new SecretStore({
      directory: dir,
      values,
      now: () => clock.now,
      restrict: async (path) => {
        restricted.push(path);
      },
      restrictDirectory: async () => {},
    });
    stores.push(store);
    return store;
  };
  return { directory, map, values, clock, restricted, open, store: open() };
}

async function createSecret(
  store: SecretStore,
  overrides: Partial<{
    sessionId: string;
    projectId: string;
    name: string;
    ttlMinutes: number | null;
    value: string;
    replaceRef: string;
  }> = {},
) {
  return store.create({
    sessionId: overrides.sessionId ?? "s1",
    projectId: overrides.projectId ?? "p1",
    requestId: "req-1",
    signature: "sig",
    name: overrides.name ?? "NPM_TOKEN",
    purpose: "publish the package",
    ttlMinutes: overrides.ttlMinutes === null ? undefined : (overrides.ttlMinutes ?? 60),
    value: overrides.value ?? VALUE,
    replaceRef: overrides.replaceRef,
  });
}

describe("SecretStore", () => {
  it("lists metadata for the owning session and never the value", async () => {
    const { store, directory } = fixture();
    const outcome = await createSecret(store);
    expect(outcome).toMatchObject({ name: "NPM_TOKEN" });
    const list = await store.list("p1");
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      secretRef: (outcome as { secretRef: string }).secretRef,
      name: "NPM_TOKEN",
      purpose: "publish the package",
      createdAt: 1_000_000,
      expiresAt: 1_000_000 + 60 * 60_000,
      materialized: false,
    });
    expect(JSON.stringify(list)).not.toContain(VALUE);
    expect(readFileSync(join(directory, "state.json"), "utf8")).not.toContain(VALUE);
    expect(await store.list("p2")).toEqual([]);
  });

  it("materializes the value into an owner-only file and asks for the ACL restriction", async () => {
    const { store, restricted, directory } = fixture();
    const { secretRef } = (await createSecret(store)) as { secretRef: string };
    const result = await store.materialize("p1", secretRef);
    expect(readFileSync(result.path, "utf8")).toBe(VALUE);
    expect(result.path).toBe(join(directory, "files", secretRef));
    expect(restricted).toEqual([result.path]);
    if (process.platform !== "win32") expect(statSync(result.path).mode & 0o777).toBe(0o600);
    expect((await store.list("p1"))[0]?.materialized).toBe(true);
  });

  it("isolates refs by project for materialize, revoke and list", async () => {
    const { store } = fixture();
    const { secretRef } = (await createSecret(store)) as { secretRef: string };
    await expect(store.materialize("p2", secretRef)).rejects.toThrow(
      "not available in this project",
    );
    await expect(store.revoke("p2", secretRef)).rejects.toThrow("not available in this project");
    expect(await store.list("p2")).toEqual([]);
    expect(await store.list("p1")).toHaveLength(1);
  });

  it("revokes by deleting the value and file", async () => {
    const { store, map } = fixture();
    const { secretRef } = (await createSecret(store)) as { secretRef: string };
    const { path } = await store.materialize("p1", secretRef);
    expect(existsSync(path)).toBe(true);
    await expect(store.revoke("p1", secretRef)).resolves.toEqual({ revoked: true, secretRef });
    expect(map.has(secretRef)).toBe(false);
    expect(existsSync(path)).toBe(false);
    expect(await store.list("p1")).toEqual([]);
  });

  it("purges expired values and files on the next operation and refuses expired refs", async () => {
    const clock = { now: 1_000_000 };
    const { store, map } = fixture(clock);
    const { secretRef } = (await createSecret(store, { ttlMinutes: 1 })) as { secretRef: string };
    const { path } = await store.materialize("p1", secretRef);
    clock.now += 60_000;
    expect(await store.list("p1")).toEqual([]);
    expect(map.has(secretRef)).toBe(false);
    expect(existsSync(path)).toBe(false);
    await expect(store.materialize("p1", secretRef)).rejects.toThrow("not available");
  });

  it("cleans expired entries and orphan files on startup", async () => {
    const clock = { now: 1_000_000 };
    const first = fixture(clock);
    const { secretRef } = (await createSecret(first.store, { ttlMinutes: 1 })) as {
      secretRef: string;
    };
    await first.store.materialize("p1", secretRef);
    const orphanDir = join(first.directory, "files");
    writeFileSync(join(orphanDir, "sec_orphanwithoutrecord"), "leftover");
    clock.now += 60_000;
    first.store.close();
    const restarted = first.open();
    await restarted.ready;
    expect(first.map.has(secretRef)).toBe(false);
    expect(existsSync(join(orphanDir, secretRef))).toBe(false);
    expect(existsSync(join(orphanDir, "sec_orphanwithoutrecord"))).toBe(false);
    expect(await restarted.list("p1")).toEqual([]);
  });

  it("keeps values out of errors when the vault fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "secret-store-leak-"));
    dirs.push(directory);
    const { map, values } = memoryValues();
    const leaky: SecretValueStore = {
      ...values,
      get: async () => {
        throw new Error(`vault said ${VALUE}`);
      },
    };
    const store = new SecretStore({
      directory,
      values: leaky,
      now: () => 1_000_000,
      restrict: async () => {},
      restrictDirectory: async () => {},
    });
    stores.push(store);
    const { secretRef } = (await createSecret(store)) as { secretRef: string };
    expect(map.get(secretRef)).toBe(VALUE);
    const error = await store.materialize("p1", secretRef).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(VALUE);
    expect(JSON.stringify(await store.list("p1"))).not.toContain(VALUE);
  });

  it("refuses a corrupt state file instead of forgetting stored refs", async () => {
    const { directory } = fixture();
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "state.json"), "{not json");
    const store = new SecretStore({
      directory,
      values: memoryValues().values,
      restrict: async () => {},
      restrictDirectory: async () => {},
    });
    stores.push(store);
    await store.ready;
    await expect(store.list("p1")).rejects.toThrow("Secret store unavailable.");
  });

  it("keeps a secret without expiry through the sweep until it is revoked", async () => {
    const clock = { now: 1_000_000 };
    const { store, map } = fixture(clock);
    const outcome = await createSecret(store, { ttlMinutes: null });
    expect(outcome).toMatchObject({ expiresAt: null });
    clock.now += 400 * 24 * 60 * 60_000;
    const list = await store.list("p1");
    expect(list).toHaveLength(1);
    expect(list[0]?.expiresAt).toBeNull();
    expect(map.size).toBe(1);
  });

  it("shares refs between sessions of a project and refuses other projects", async () => {
    const { store } = fixture();
    const { secretRef } = (await createSecret(store, { sessionId: "s1" })) as {
      secretRef: string;
    };
    await expect(store.materialize("p1", secretRef)).resolves.toBeTruthy();
    await expect(store.readValues("p2", [secretRef])).rejects.toThrow("not available");
    await expect(store.readValues("p1", [secretRef])).resolves.toEqual([
      { secretRef, name: "NPM_TOKEN", value: VALUE },
    ]);
  });

  it("finds live secrets by trimmed, case-insensitive name within the project", async () => {
    const { store } = fixture();
    await createSecret(store, { ttlMinutes: null });
    expect((await store.findByName("p1", "  npm_token "))?.name).toBe("NPM_TOKEN");
    expect(await store.findByName("p2", "NPM_TOKEN")).toBeUndefined();
  });

  it("replaces a secret and purges the old value after the new one is saved", async () => {
    const { store, map } = fixture();
    const first = (await createSecret(store)) as { secretRef: string };
    const second = (await createSecret(store, {
      value: "second-secret-value",
      replaceRef: first.secretRef,
    })) as { secretRef: string };
    expect(map.has(first.secretRef)).toBe(false);
    expect(map.get(second.secretRef)).toBe("second-secret-value");
    expect((await store.list("p1")).map((entry) => entry.secretRef)).toEqual([second.secretRef]);
  });

  it("limits secrets per project, not globally", async () => {
    const { store } = fixture();
    for (let index = 0; index < MAX_SECRETS; index += 1)
      await createSecret(store, { name: `S${index}`, ttlMinutes: null });
    await expect(createSecret(store, { name: "extra" })).rejects.toThrow("Too many");
    await expect(createSecret(store, { name: "extra", projectId: "p2" })).resolves.toBeTruthy();
  });

  it("deletes expired materialized files without deleting the secret", async () => {
    const clock = { now: 1_000_000 };
    const { store, map } = fixture(clock);
    const { secretRef } = (await createSecret(store, { ttlMinutes: null })) as {
      secretRef: string;
    };
    const result = await store.materialize("p1", secretRef);
    expect(result.expiresAt).toBe(1_000_000 + FILE_TTL_MS);
    clock.now += FILE_TTL_MS - 1;
    expect((await store.list("p1"))[0]?.materialized).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    clock.now += 1;
    const [entry] = await store.list("p1");
    expect(entry?.materialized).toBe(false);
    expect(existsSync(result.path)).toBe(false);
    expect(map.has(secretRef)).toBe(true);
  });

  it("exposes live values, owner views and owner revoke", async () => {
    const { store, map } = fixture();
    const live = (await createSecret(store, { ttlMinutes: null })) as { secretRef: string };
    await createSecret(store, { name: "OTHER", projectId: "p2", value: "other-project-value" });
    expect(await store.liveValues("p1")).toEqual([{ name: "NPM_TOKEN", value: VALUE }]);
    const all = await store.listAll();
    expect(all.map((entry) => entry.projectId).sort()).toEqual(["p1", "p2"]);
    expect(JSON.stringify(all)).not.toContain(VALUE);
    await store.ownerRevoke(live.secretRef);
    expect(map.has(live.secretRef)).toBe(false);
    expect(await store.liveValues("p1")).toEqual([]);
  });

  it("skips unreadable values in liveValues", async () => {
    const { store, values } = fixture();
    await createSecret(store);
    values.get = async () => {
      throw new Error("vault down");
    };
    expect(await store.liveValues("p1")).toEqual([]);
  });

  it("reads old state files with numeric expiry and no file expiry", async () => {
    const { directory, map, open } = fixture();
    map.set("sec_old", VALUE);
    writeFileSync(
      join(directory, "state.json"),
      JSON.stringify({
        version: 1,
        requests: [],
        secrets: [
          {
            secretRef: "sec_old",
            sessionId: "s1",
            projectId: "p1",
            requestId: "r",
            name: "OLD",
            purpose: "p",
            createdAt: 1,
            expiresAt: 9_999_999_999,
            materialized: true,
            filePath: join(directory, "files", "sec_old"),
          },
        ],
      }),
    );
    const store = open();
    const [entry] = await store.list("p1");
    expect(entry).toMatchObject({ secretRef: "sec_old", materialized: false });
  });

  it("restricts the secrets directory on startup and survives a failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "secret-store-dir-"));
    dirs.push(directory);
    const seen: string[] = [];
    const ok = new SecretStore({
      directory,
      values: memoryValues().values,
      restrict: async () => {},
      restrictDirectory: async (path) => {
        seen.push(path);
      },
    });
    stores.push(ok);
    await ok.ready;
    expect(seen).toEqual([directory]);
    const failing = new SecretStore({
      directory,
      values: memoryValues().values,
      restrict: async () => {},
      restrictDirectory: async () => {
        throw new Error("acl failed");
      },
    });
    stores.push(failing);
    await failing.ready;
    expect(await failing.list("p1")).toEqual([]);
  });
});
