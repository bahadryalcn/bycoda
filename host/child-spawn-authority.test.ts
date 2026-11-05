import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { HarnessProcessReceipt } from "../src/shared/model/harnessProcess";
import type { SocialService } from "./social/social";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});
vi.mock("./providers/provider-accounts", () => ({
  providerAccountEnvironment: vi.fn(async () => ({
    set: { PROBE_ACCOUNT_SECRET: "fixture-only-secret" },
    remove: [],
  })),
}));
import { spawn } from "node:child_process";
import { providerAccountEnvironment } from "./providers/provider-accounts";
import { HostChildBackend } from "./child-backend";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
});
async function fixture() {
  const parent = resolve("temp/test-results/child-spawn-authority");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "owned-"));
  const marker = join(directory, "started");
  const file = join(directory, "fixture.cjs");
  await writeFile(
    file,
    `require('node:fs').appendFileSync(${JSON.stringify(marker)},'started\\n'); console.log('ready'); setInterval(()=>{},1000);`,
  );
  const backend = new HostChildBackend();
  cleanups.push(async () => {
    await backend.close();
    if (!directory.startsWith(`${parent}\\`) && !directory.startsWith(`${parent}/`))
      throw new Error("Unexpected child-spawn fixture directory");
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const args = {
    sessionId: `owned-probe-${randomUUID()}`,
    command: file,
    args: [],
    cwd: directory,
    account: { provider: "codex", id: "default" },
  };
  const internal = backend as unknown as {
    children: Map<string, { pid: number }>;
    socialEnvironments: Map<string, unknown>;
    conversationEnvironments: Map<string, unknown>;
    runtimeLogEnvironments: Map<string, unknown>;
    preparedTools: Map<string, unknown>;
  };
  return { backend, args, internal, marker, file };
}

it("denies before account/environment preparation and rejects a JSON-shaped callback", async () => {
  const f = await fixture();
  await expect(
    f.backend.invoke("harness_spawn", {
      ...f.args,
      beforeSpawn: async () => {
        throw new Error("Probe grant revoked");
      },
    }),
  ).rejects.toThrow("revoked");
  await expect(
    f.backend.invoke("harness_spawn", { ...f.args, beforeSpawn: { allowed: true } }),
  ).rejects.toThrow("in-process function");
  expect(spawn).not.toHaveBeenCalled();
  expect(providerAccountEnvironment).not.toHaveBeenCalled();
  expect(f.internal.children.size).toBe(0);
  await expect(access(f.marker)).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not fork or publish prepared tool/account secrets after a deferred preparation is revoked", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred<{ token: string; endpoint: string; environmentId: string }>();
  f.backend.setSocialAccess(
    {
      remoteAccess: async () => {
        entered.resolve();
        return release.promise;
      },
    } as unknown as SocialService,
    "http://127.0.0.1:1",
  );
  let authorized = true;
  const beforeSpawn = async () => {
    if (!authorized) throw new Error("Probe grant revoked");
  };
  const pending = f.backend.invoke("harness_spawn", { ...f.args, beforeSpawn });
  const denied = expect(pending).rejects.toThrow("revoked");
  try {
    await entered.promise;
    authorized = false;
    release.resolve({
      token: "fixture-private-tool-token",
      endpoint: "http://127.0.0.1:1",
      environmentId: "fixture",
    });
    await denied;
    expect(spawn).not.toHaveBeenCalled();
    expect(f.internal.children.size).toBe(0);
    expect(f.internal.socialEnvironments.size).toBe(0);
    expect(f.internal.conversationEnvironments.size).toBe(0);
    expect(f.internal.runtimeLogEnvironments.size).toBe(0);
    expect(f.internal.preparedTools.size).toBe(0);
    await expect(access(f.marker)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    release.resolve({
      token: "fixture-private-tool-token",
      endpoint: "http://127.0.0.1:1",
      environmentId: "fixture",
    });
    await denied;
  }
});

it("does not retire an existing owned child when a replacement's deferred preparation is revoked", async () => {
  const f = await fixture();
  const incumbent = await f.backend.invoke<HarnessProcessReceipt>("harness_spawn", f.args);
  await vi.waitFor(async () => expect(await readFile(f.marker, "utf8")).toBe("started\n"));
  vi.mocked(spawn).mockClear();
  vi.mocked(providerAccountEnvironment).mockClear();
  const entered = deferred();
  const release = deferred();
  f.backend.setGenericAcpService({
    get: async () => {
      entered.resolve();
      await release.promise;
      return { command: f.file, args: [], env: { PRIVATE_REPLACEMENT_SECRET: "fixture-only" } };
    },
  } as never);
  let authorized = true;
  const pending = f.backend.invoke("harness_spawn", {
    ...f.args,
    genericAcpId: "owned-test",
    beforeSpawn: async () => {
      if (!authorized) throw new Error("Probe grant revoked");
    },
  });
  const denied = expect(pending).rejects.toThrow("revoked");
  try {
    await entered.promise;
    authorized = false;
    release.resolve();
    await denied;
    expect(spawn).not.toHaveBeenCalled();
    expect(providerAccountEnvironment).not.toHaveBeenCalled();
    expect(f.internal.children.get(f.args.sessionId)?.pid).toBe(incumbent.pid);
    expect(() => process.kill(incumbent.pid, 0)).not.toThrow();
    expect(await readFile(f.marker, "utf8")).toBe("started\n");
  } finally {
    release.resolve();
    await denied;
  }
});
