import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Transform } from "node:stream";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { HostStore } from "../store";
import { HostAuthorityJournal } from "../storage/authority-journal";
import { createNativeSnapshotConverter } from "../storage/native-snapshot-converter";
import { createNativeTargetInstaller } from "../storage/native-target-installer";
import { SessionViewSchema } from "../../src/shared/model/host-contracts/session-reads";
import { writeNativeHelperDeployment, createNativeSourceHelperProvider } from "./deployment";
import { NativeSourceRegistry } from "./source-registry";
import { createNativeAuthorityBootstrap, NATIVE_AUTHORITY_BOOTSTRAP_PATH } from "./bootstrap";

const sourceExecutable = process.env.BYCODA_NATIVE_AUTHORITY_TEST_EXE;
const enabled = process.platform === "win32" && !!sourceExecutable && isAbsolute(sourceExecutable);
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

class Prelude extends Transform {
  private pending = Buffer.alloc(0);
  private ready = false;
  private skipped = 0;
  constructor(private readonly marker: string) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ) {
    if (this.ready) {
      this.push(chunk);
      done();
      return;
    }
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      const end = this.pending.indexOf(10);
      if (end < 0) break;
      const line = this.pending.subarray(0, end).toString("utf8").trim();
      this.skipped += end + 1;
      this.pending = this.pending.subarray(end + 1);
      if (line === this.marker) {
        this.ready = true;
        this.push(this.pending);
        this.pending = Buffer.alloc(0);
        done();
        return;
      }
    }
    done(
      this.skipped + this.pending.length > 4096
        ? new Error("Native source fixture prelude overflow")
        : undefined,
    );
  }
  override _flush(done: (error?: Error | null) => void) {
    done(this.ready ? undefined : new Error("Native source fixture marker missing"));
  }
}
function frameStream(child: ChildProcessWithoutNullStreams, marker: string): Prelude {
  const stream = new Prelude(marker);
  stream.on("error", () => {});
  child.stdout.on("error", (error) => stream.destroy(error));
  child.stdout.pipe(stream);
  return stream;
}
type Descriptor = {
  version: 1;
  address: string;
  registrationNonce: string;
  sourceEpoch: string;
  environmentId: string;
  sourceStoreId: string;
  sourceProfileId: string;
  profileDirectory: string;
  retainedSessionId: string;
  retainedMigrationId: string;
  retainedBytes: number;
  retainedDigest: string;
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-source-interop-"));
  cleanup.push(async () => {
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-source-interop-")
    )
      throw new Error("Unexpected source test cleanup target");
    await rm(target, { recursive: true, force: true });
  });
  const hostDirectory = join(directory, "host");
  await mkdir(hostDirectory);
  const store = new HostStore(join(hostDirectory, "host.db"));
  cleanup.push(() => store.close());
  await store.ready;
  const nativeDirectory = join(directory, "native");
  await mkdir(nativeDirectory);
  const executable = join(nativeDirectory, "native-test.exe");
  await copyFile(sourceExecutable!, executable);
  const source = spawn(
    executable,
    [
      "--ignored",
      "--exact",
      "native_authority_runtime::tests::private_source_fixture",
      "--nocapture",
    ],
    {
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: directory,
        TMP: directory,
        BYCODA_NATIVE_SOURCE_FIXTURE_ENVIRONMENT: store.environmentId,
      },
    },
  );
  source.stderr.resume();
  const exited = new Promise<number | null>((resolve, reject) => {
    source.once("exit", resolve);
    source.once("error", reject);
  });
  void exited.catch(() => {});
  cleanup.push(async () => {
    if (source.exitCode === null && source.signalCode === null) source.kill();
    await exited;
  });
  const stream = frameStream(source, "NATIVE_SOURCE_FIXTURE");
  const descriptor = await new Promise<Descriptor>((resolve, reject) => {
    let text = "";
    const timer = setTimeout(
      () => reject(new Error("Native source fixture startup deadline")),
      5000,
    );
    stream.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    stream.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      if (text.length > 8192) {
        clearTimeout(timer);
        reject(new Error("Native source fixture descriptor overflow"));
        return;
      }
      const end = text.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(text.slice(0, end)) as Descriptor);
      } catch (error) {
        reject(error);
      }
    });
  });
  expect(dirname(resolve(descriptor.profileDirectory))).toBe(resolve(directory));
  expect(basename(descriptor.profileDirectory)).toMatch(/^bycoda-native-source-fixture-/);
  const project = await store.addProject(descriptor.profileDirectory, "Native migration fixture");
  const bytes = await readFile(executable);
  const deployment = await writeNativeHelperDeployment(hostDirectory, {
    version: 1,
    platform: "win32",
    canonicalHostDirectory: hostDirectory,
    applicationIdentifier: "com.bycoda.source.fixture",
    canonicalNativeProfileDirectory: descriptor.profileDirectory,
    sourceProfileId: descriptor.sourceProfileId,
    canonicalGUIExecutablePath: executable,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    executableSize: bytes.length,
    helperProtocol: 1,
  });
  const provider = createNativeSourceHelperProvider({
    directory: hostDirectory,
    spawn: (selectedExecutable, _args, options) => {
      const child = spawn(
        selectedExecutable,
        [
          "--ignored",
          "--exact",
          "native_authority_helper::tests::windows::hidden_stdio_helper",
          "--nocapture",
        ],
        options,
      );
      Object.defineProperty(child, "stdout", {
        value: frameStream(child, "NATIVE_AUTHORITY_HELPER_FIXTURE"),
      });
      return child;
    },
  });
  const registry = new NativeSourceRegistry({
    provider,
    environmentId: descriptor.environmentId,
    heartbeatMs: 100,
  });
  cleanup.push(() => registry.close());
  const secret = randomBytes(32).toString("base64url");
  const handler = createNativeAuthorityBootstrap({
    secret,
    environmentId: descriptor.environmentId,
    registry,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    await handler.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${NATIVE_AUTHORITY_BOOTSTRAP_PATH}`;
  const request = (action: string, body: object) =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ version: 1, action, ...body }),
    });
  const post = async (action: string, body: object) => {
    const response = await request(action, body);
    expect(response.status).toBe(200);
    return response.json();
  };
  const registration = {
    address: descriptor.address,
    registrationNonce: descriptor.registrationNonce,
    expectedHostEnvironmentId: descriptor.environmentId,
    deploymentId: deployment.sourceProfileId,
  };
  const register = async () => {
    // A detached HTTP waiter does not cancel admitted native/helper startup.
    // Recover the original nonce through lookup; never resend registration here.
    const response = await request("register-source", registration);
    if (response.status === 200) return response.json();
    expect(response.status).toBe(408);
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) {
      const result = await post("lookup-source", {
        deploymentId: registration.deploymentId,
        registrationNonce: registration.registrationNonce,
        expectedHostEnvironmentId: descriptor.environmentId,
      });
      if (result.state === "associated") return result.association;
      expect(result.state).toBe("pending");
      await delay(10);
    }
    throw new Error("Actual native registration recovery deadline");
  };
  return { descriptor, registry, provider, store, project, post, register, registration, exited };
}

describe.skipIf(!enabled)("actual native Store source/private Host association", () => {
  it("binds actual native identities through deployment, helper, HTTP lookup/status and retirement", async () => {
    const f = await fixture();
    const associated = await f.register();
    expect(associated).toMatchObject({
      version: 1,
      sourceEpoch: f.descriptor.sourceEpoch,
      environmentId: f.descriptor.environmentId,
      sourceStoreId: f.descriptor.sourceStoreId,
      sourceProfileId: f.descriptor.sourceProfileId,
      writerProtocol: 2,
      qualified: false,
    });
    const duplicate = await f.post("register-source", f.registration);
    expect(duplicate).toEqual(associated);
    const lookup = await f.post("lookup-source", {
      deploymentId: f.registration.deploymentId,
      registrationNonce: f.registration.registrationNonce,
      expectedHostEnvironmentId: f.descriptor.environmentId,
    });
    expect(lookup).toEqual({
      version: 1,
      state: "associated",
      association: associated,
      qualified: false,
    });
    const reference = {
      associationId: associated.associationId,
      sourceEpoch: associated.sourceEpoch,
    };
    const scope = {
      sessionId: f.descriptor.retainedSessionId,
      migrationId: f.descriptor.retainedMigrationId,
    };
    expect(
      await f.registry.readRetainedSnapshot(reference, {
        ...scope,
        migrationId: "absent-fixture-migration",
      }),
    ).toEqual({ state: "absent", qualified: false });
    const retained = await f.registry.readRetainedSnapshot(reference, scope);
    expect(retained.state).toBe("retained");
    if (retained.state !== "retained") throw new Error("Missing actual retained snapshot");
    expect(retained.qualified).toBe(false);
    expect(Buffer.byteLength(retained.sourceJson)).toBe(f.descriptor.retainedBytes);
    expect(f.descriptor.retainedBytes).toBeGreaterThan(4 * 16384);
    expect(createHash("sha256").update(retained.sourceJson, "utf8").digest("hex")).toBe(
      f.descriptor.retainedDigest,
    );
    expect(retained.fence).toMatchObject({
      ...scope,
      sourceStoreId: f.descriptor.sourceStoreId,
      sourceProfileId: f.descriptor.sourceProfileId,
      sourceDigest: f.descriptor.retainedDigest,
    });
    expect(JSON.parse(retained.sourceJson).session.blocks[0].text).toBe(
      "İstanbul 🦀 𝄞 日本語\n".repeat(4096),
    );
    if (process.env.BYCODA_CAPTURE_NATIVE_SNAPSHOT === "1") {
      // Opt-in owned fixture output for the migration converter's real-source
      // checks. It contains isolated test data, not a live profile or actor proof.
      await writeFile(
        join(
          process.cwd(),
          "temp/verification/2026-10-28-native-target/native-snapshot-capture.json",
        ),
        JSON.stringify({ sourceJson: retained.sourceJson, fence: retained.fence }, null, 2) + "\n",
        { flag: "wx" },
      );
    }
    // This composes actual Native/Host storage with an explicitly synthetic
    // verifier. It is not production actor enrollment or a Native decision ACK.
    const context = {
      ...scope,
      environmentId: f.store.environmentId,
      sourceProfileId: f.descriptor.sourceProfileId,
      sourceStoreId: f.descriptor.sourceStoreId,
      nativeActorId: "isolated-source-interop-fixture",
      challenge: "isolated-source-interop-challenge",
    };
    const converter = createNativeSnapshotConverter({
      projectId: f.project.id,
      expectedCwd: f.descriptor.profileDirectory,
    });
    const journal = new HostAuthorityJournal({
      store: f.store,
      verifyNativeActorAndChallenge: async (fence, actual) => {
        expect(actual).toEqual(context);
        expect(fence).toEqual(retained.fence);
      },
      installTarget: createNativeTargetInstaller({
        store: f.store,
        projectId: f.project.id,
        expectedCwd: f.descriptor.profileDirectory,
      }),
    });
    await journal.prepare(retained.fence, context);
    await journal.stage(
      {
        fence: retained.fence,
        sourceJson: retained.sourceJson,
        normalizedSnapshot: converter.convert(JSON.parse(retained.sourceJson), retained.fence),
        converterVersion: converter.version,
      },
      context,
    );
    const decision = await journal.activate(retained.fence, context);
    const installed = await f.store.session(scope.sessionId);
    expect(installed.authorityGeneration).toBe(decision.authorityGeneration);
    expect(installed.session.blocks[0]?.text).toBe("İstanbul 🦀 𝄞 日本語\n".repeat(4096));
    expect(installed).not.toHaveProperty("nativePreservation");
    expect(installed).not.toHaveProperty("nativeMigration");
    expect(SessionViewSchema.safeParse(installed).success).toBe(true);
    expect(JSON.stringify(installed)).not.toContain("Native private unsent draft");
    expect(JSON.stringify(installed)).not.toContain("Native private queued prompt");
    const privateCopy = await journal.readNativePreservation(retained.fence, context);
    expect(privateCopy?.sourceDigest).toBe(retained.fence.sourceDigest);
    expect(privateCopy?.clientOwnedQueue).toEqual([
      { id: "native-client-only", text: "Native private queued prompt", attachments: [] },
    ]);
    expect(JSON.parse(privateCopy!.clientOwnedDraftJson!)).toEqual({
      text: "Native private unsent draft",
      mcpTags: [],
      attachments: [],
    });
    expect(privateCopy?.retainedNativeRows).toEqual(
      JSON.parse(retained.sourceJson).retainedNativeRows,
    );
    expect(await f.post("source-status", reference)).toEqual(associated);
    expect(f.provider.observation().activeHelpers).toBe(1);
    expect(await f.post("unregister-source", reference)).toEqual({
      version: 1,
      ...reference,
      retired: true,
      qualified: false,
    });
    expect(f.provider.observation().activeHelpers).toBe(0);
    expect(await f.exited).toBe(0);
  });
});
