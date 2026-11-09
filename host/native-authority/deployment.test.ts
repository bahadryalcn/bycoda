import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNativeSourceHelperProvider,
  writeNativeHelperDeployment,
  type NativeHelperDeploymentInput,
} from "./deployment";

const helperFixture = fileURLToPath(new URL("./fixtures/helper.mjs", import.meta.url));
const address = "\\\\.\\pipe\\bycoda-authority-v1-" + "a".repeat(32);
const temporaryRoots: string[] = [];
const providers: ReturnType<typeof createNativeSourceHelperProvider>[] = [];
const windows = process.platform === "win32";

async function fixture(
  mode = "normal",
  delayedExit = false,
  beforeSpawnVerification?: () => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-native-deployment-")));
  temporaryRoots.push(root);
  const directory = join(root, "host");
  const profile = join(root, "profile");
  await mkdir(directory, { mode: 0o700 });
  await mkdir(profile, { mode: 0o700 });
  const executable = join(root, "fixture-native.exe");
  // Deliberately synthetic selected artifact. The injected spawner runs an actual
  // Node child; this fixture does not establish installed/native-image identity.
  const bytes = Buffer.from("synthetic local deployment artifact v1");
  await writeFile(executable, bytes);
  const input: NativeHelperDeploymentInput = {
    version: 1,
    platform: process.platform as NativeHelperDeploymentInput["platform"],
    canonicalHostDirectory: await realpath(directory),
    applicationIdentifier: "com.bycoda.desktop.dev",
    canonicalNativeProfileDirectory: await realpath(profile),
    sourceProfileId: randomUUID(),
    canonicalGUIExecutablePath: await realpath(executable),
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    executableSize: bytes.length,
    helperProtocol: 1,
    sourceBuildMetadata: { version: "fixture" },
  };
  const record = await writeNativeHelperDeployment(directory, input);
  const children: ChildProcessWithoutNullStreams[] = [];
  let onSpawn: (() => void) | undefined;
  let onTermination: (() => void) | undefined;
  const provider = createNativeSourceHelperProvider({
    directory,
    beforeSpawnVerification,
    spawn: (file, args, launch) => {
      expect(file).toBe(input.canonicalGUIExecutablePath);
      expect(args).toEqual(["--native-authority-helper"]);
      expect(launch).toMatchObject({
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const child = spawn(process.execPath, [helperFixture, mode, "-", ...args], launch);
      if (delayedExit) {
        const actualKill = child.kill.bind(child);
        child.kill = (signal) => {
          onTermination?.();
          setTimeout(() => actualKill(signal), 200);
          return true;
        };
      }
      children.push(child);
      onSpawn?.();
      return child;
    },
  });
  providers.push(provider);
  const grant = join(directory, "native-authority", "deployments", `${input.sourceProfileId}.json`);
  return {
    root,
    directory,
    profile,
    executable,
    input,
    record,
    grant,
    children,
    provider,
    onSpawn: (callback: () => void) => {
      onSpawn = callback;
    },
    onTermination: (callback: () => void) => {
      onTermination = callback;
    },
  };
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
  for (const directory of temporaryRoots.splice(0)) {
    const target = resolve(directory);
    if (
      !basename(target).startsWith("bycoda-native-deployment-") ||
      dirname(target).toLowerCase() !== (await realpath(tmpdir())).toLowerCase()
    )
      throw new Error("Unsafe test cleanup");
    await rm(target, { recursive: true, force: true });
  }
});

describe("trusted local native helper deployment", () => {
  it("preserves generation on identical local retries and atomically changes it for a new artifact", async () => {
    const f = await fixture();
    const original = await readFile(f.grant, "utf8");
    const retry = await writeNativeHelperDeployment(f.directory, { ...f.input });
    expect(retry).toEqual(f.record);
    expect(await readFile(f.grant, "utf8")).toBe(original);
    const next = Buffer.from("synthetic local deployment artifact v2");
    await writeFile(f.executable, next);
    const replaced = await writeNativeHelperDeployment(f.directory, {
      ...f.input,
      rawSha256: createHash("sha256").update(next).digest("hex"),
      executableSize: next.length,
    });
    expect(replaced.generation).not.toBe(retry.generation);
    expect(JSON.parse(await readFile(f.grant, "utf8"))).toEqual(replaced);
    expect(replaced).not.toHaveProperty("qualified");
  });

  it("rejects untrusted extra fields, profile/Host mismatch, stale hash and relative paths without replacing a grant", async () => {
    const f = await fixture();
    const original = await readFile(f.grant, "utf8");
    for (const input of [
      { ...f.input, executablePath: process.execPath },
      { ...f.input, canonicalHostDirectory: f.profile },
      { ...f.input, canonicalNativeProfileDirectory: "relative" },
      { ...f.input, rawSha256: "0".repeat(64) },
      { ...f.input, sourceProfileId: "../escape" },
      { ...f.input, sourceBuildMetadata: { qualified: "true" } },
    ])
      await expect(writeNativeHelperDeployment(f.directory, input)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
    expect(await readFile(f.grant, "utf8")).toBe(original);
  });

  it("cannot use a directory link as the native profile or deployment directory", async () => {
    const f = await fixture();
    const alias = join(f.root, "linked-profile");
    await symlink(f.profile, alias, windows ? "junction" : "dir");
    await expect(
      writeNativeHelperDeployment(f.directory, {
        ...f.input,
        canonicalNativeProfileDirectory: alias,
      }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_UNAVAILABLE" });
    if (windows) {
      const second = join(f.root, "aliased-host");
      await symlink(f.directory, second, "junction");
      const provider = createNativeSourceHelperProvider({
        directory: second,
        spawn: () => {
          throw new Error("Must not spawn");
        },
      });
      providers.push(provider);
      await expect(provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
    }
  });

  it("rejects hard-linked existing grants and never overwrites their other name", async () => {
    const f = await fixture();
    const other = join(f.root, "grant-hardlink");
    await link(f.grant, other);
    const original = await readFile(other, "utf8");
    await expect(writeNativeHelperDeployment(f.directory, f.input)).rejects.toMatchObject({
      code: "DEPLOYMENT_UNAVAILABLE",
    });
    expect(await readFile(other, "utf8")).toBe(original);
    await expect(f.provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
      code: "DEPLOYMENT_UNAVAILABLE",
    });
    expect(f.children).toHaveLength(0);
  });

  it("never selects a path from registration and never spawns for missing, malformed or oversized grants", async () => {
    const f = await fixture();
    for (const locator of ["../native.exe", f.executable, randomUUID()])
      await expect(f.provider.open(locator, address)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
    for (const bytes of [
      "{",
      "x".repeat(8193),
      JSON.stringify({ ...f.record, sourceProfileId: randomUUID() }),
      JSON.stringify({ ...f.record, canonicalHostDirectory: f.profile }),
      JSON.stringify({ ...f.record, helperProtocol: 2 }),
    ]) {
      await writeFile(f.grant, bytes);
      await expect(f.provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
    }
    expect(f.children).toHaveLength(0);
  });

  it("rejects changed executable bytes before spawning, even when the byte count matches", async () => {
    const f = await fixture();
    await writeFile(f.executable, Buffer.alloc(f.input.executableSize, 0x61));
    await expect(f.provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
      code: "DEPLOYMENT_UNAVAILABLE",
    });
    expect(f.children).toHaveLength(0);
  });

  it.runIf(!windows)(
    "keeps the transport disabled on platforms with no native helper adapter",
    async () => {
      const f = await fixture();
      await chmod(f.grant, 0o644);
      await expect(f.provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
      expect(f.children).toHaveLength(0);
    },
  );

  it.runIf(windows)(
    "uses a verified local selection for an actual child and awaits its exit on provider close",
    async () => {
      const f = await fixture();
      const result = await f.provider.open(f.input.sourceProfileId, address);
      expect(result.expectedSourceProfileId).toBe(f.input.sourceProfileId);
      expect(f.provider.observation().activeHelpers).toBe(1);
      await result.client.send({ fixture: "selected" });
      expect(await result.client.receive()).toEqual({ fixture: "selected" });
      const closing = f.provider.close();
      await closing;
      expect((await result.client.exited).spawned).toBe(true);
      expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true);
      expect(f.provider.observation().activeHelpers).toBe(0);
      await expect(f.provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
    },
  );

  it.runIf(windows)(
    "closing during asynchronous grant validation forbids a later spawn",
    async () => {
      const f = await fixture();
      const opening = f.provider.open(f.input.sourceProfileId, address);
      const rejection = expect(opening).rejects.toMatchObject({ code: "DEPLOYMENT_UNAVAILABLE" });
      await f.provider.close();
      await rejection;
      expect(f.children).toHaveLength(0);
    },
  );

  it.runIf(windows)(
    "keeps HTTP control and timers responsive while late pre-spawn verification is pending",
    async () => {
      let entered!: () => void;
      let release!: () => void;
      const lateVerification = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const verificationGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const f = await fixture("normal", false, async () => {
        entered();
        await verificationGate;
      });
      // The same Node event loop serves this real control endpoint and provider.open.
      const control = createServer((_request, response) => response.end("responsive"));
      await new Promise<void>((resolve) => control.listen(0, "127.0.0.1", resolve));
      const location = control.address();
      if (!location || typeof location === "string") throw new Error("Missing test HTTP address");
      const opening = f.provider.open(f.input.sourceProfileId, address);
      void opening.catch(() => {});
      try {
        // This point is after the complete initial asynchronous deployment load,
        // precisely where the old synchronous final ACL/hash stage used to run.
        await lateVerification;
        expect(f.children).toHaveLength(0);
        const [reply, tick] = await Promise.all([
          fetch(`http://127.0.0.1:${location.port}/control`, {
            signal: AbortSignal.timeout(1000),
          }).then((response) => response.text()),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10)),
        ]);
        expect(reply).toBe("responsive");
        expect(tick).toBe(true);
        expect(f.children).toHaveLength(0);
        release();
        expect((await opening).expectedSourceProfileId).toBe(f.input.sourceProfileId);
      } finally {
        release();
        await f.provider.close();
        await new Promise<void>((resolve, reject) =>
          control.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it.runIf(windows)(
    "rejects an artifact replaced after the initial load while late verification waits",
    async () => {
      let entered!: () => void;
      let release!: () => void;
      const lateVerification = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const verificationGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const f = await fixture("normal", false, async () => {
        entered();
        await verificationGate;
      });
      const opening = f.provider.open(f.input.sourceProfileId, address);
      const rejected = expect(opening).rejects.toMatchObject({ code: "DEPLOYMENT_UNAVAILABLE" });
      try {
        await lateVerification;
        await writeFile(f.executable, Buffer.alloc(f.input.executableSize, 0x62));
      } finally {
        release();
      }
      await rejected;
      expect(f.children).toHaveLength(0);
    },
  );

  it.runIf(windows)("retains an aborted first client's signal only for that attempt", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const first = await f.provider.open(f.input.sourceProfileId, address, {
      signal: controller.signal,
    });
    await first.client.close();
    await first.client.exited;
    controller.abort();
    const second = await f.provider.open(f.input.sourceProfileId, address);
    expect(second.expectedSourceProfileId).toBe(f.input.sourceProfileId);
    expect(f.children).toHaveLength(2);
  });

  it.runIf(windows)(
    "never returns a child when the verified grant changes during startup",
    async () => {
      const f = await fixture();
      let changed: Promise<void> = Promise.resolve();
      f.onSpawn(() => {
        changed = writeFile(f.grant, JSON.stringify({ ...f.record, generation: randomUUID() }));
      });
      await expect(f.provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
      await changed;
      expect(f.children).toHaveLength(1);
      expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true);
      expect(f.provider.observation().activeHelpers).toBe(0);
    },
  );

  it.runIf(windows)(
    "keeps failed startup admission until the actual child exit and close drains it",
    async () => {
      const f = await fixture("bad-ready", true);
      let spawned!: () => void;
      const started = new Promise<void>((resolve) => {
        spawned = resolve;
      });
      f.onSpawn(spawned);
      let termination!: () => void;
      const terminating = new Promise<void>((resolve) => {
        termination = resolve;
      });
      f.onTermination(termination);
      let settled = false;
      const opening = f.provider.open(f.input.sourceProfileId, address);
      const rejected = opening.catch((error: unknown) => {
        settled = true;
        return error;
      });
      await started;
      await terminating;
      expect(f.provider.observation().activeHelpers).toBe(1);
      expect(settled).toBe(false);
      expect(f.children[0].exitCode).toBe(null);
      await f.provider.close();
      expect((await rejected) as object).toHaveProperty("code");
      expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true);
      expect(f.provider.observation().activeHelpers).toBe(0);
    },
  );

  it.runIf(windows)(
    "allows a fully reverified byte-identical replacement without generation churn",
    async () => {
      const f = await fixture();
      const original = await f.provider.open(f.input.sourceProfileId, address);
      await original.client.close();
      await original.client.exited;
      const bytes = await readFile(f.executable);
      await writeFile(f.executable, bytes);
      const retry = await writeNativeHelperDeployment(f.directory, f.input);
      expect(retry.generation).toBe(f.record.generation);
      const replacement = await f.provider.open(f.input.sourceProfileId, address);
      expect(replacement.expectedSourceProfileId).toBe(f.input.sourceProfileId);
      expect(f.children).toHaveLength(2);
    },
  );

  it.runIf(windows)(
    "caps aggregate live helper leases across deployment generations",
    async () => {
      const f = await fixture();
      let first: Awaited<ReturnType<typeof f.provider.open>> | undefined;
      for (let index = 0; index < 4; index++) {
        if (index)
          await writeNativeHelperDeployment(f.directory, {
            ...f.input,
            sourceBuildMetadata: { version: `fixture-${index}` },
          });
        const opened = await f.provider.open(f.input.sourceProfileId, address);
        first ??= opened;
      }
      expect(f.provider.observation().activeHelpers).toBe(4);
      await expect(f.provider.open(f.input.sourceProfileId, address)).rejects.toMatchObject({
        code: "DEPLOYMENT_UNAVAILABLE",
      });
      expect(f.children).toHaveLength(4);
      await first!.client.close();
      await first!.client.exited;
      await writeNativeHelperDeployment(f.directory, {
        ...f.input,
        sourceBuildMetadata: { version: "fixture-4" },
      });
      await f.provider.open(f.input.sourceProfileId, address);
      expect(f.children).toHaveLength(5);
      expect(f.provider.observation().activeHelpers).toBe(4);
      await f.provider.close();
      expect(f.provider.observation().activeHelpers).toBe(0);
      // Five generations each perform real Windows ACL and executable verification.
      // Keep the suite's normal deadline for ordinary cases.
    },
    120_000,
  );

  it.runIf(windows)("a new generation never rebinds an existing live helper", async () => {
    const f = await fixture();
    const original = await f.provider.open(f.input.sourceProfileId, address);
    const next = await writeNativeHelperDeployment(f.directory, {
      ...f.input,
      sourceBuildMetadata: { version: "fixture-2" },
    });
    expect(next.generation).not.toBe(f.record.generation);
    const replacement = await f.provider.open(f.input.sourceProfileId, address);
    expect(f.children).toHaveLength(2);
    await original.client.send({ generation: "old" });
    await replacement.client.send({ generation: "new" });
    expect(await original.client.receive()).toEqual({ generation: "old" });
    expect(await replacement.client.receive()).toEqual({ generation: "new" });
    expect(f.provider.observation().activeHelpers).toBe(2);
  });
});
