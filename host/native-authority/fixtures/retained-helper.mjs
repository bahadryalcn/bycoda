// Test-only real Node child for retained exports; no native Store/authority proof.
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ownPath = fileURLToPath(import.meta.url);
const evidence = resolve("temp/verification/2026-10-28-native-retained-source");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

export async function retainedFixture({ Runtime, Registry, registryOptions = {}, config = {} }) {
  await mkdir(evidence, { recursive: true });
  const directory = await mkdtemp(join(evidence, "fixture-"));
  const audit = join(directory, "audit.jsonl");
  const settings = {
    environmentId: "retained-env",
    sourceStoreId: randomUUID(),
    sourceProfileId: randomUUID(),
    sourceEpoch: randomUUID(),
    registrationNonce: randomUUID(),
    sourceJson: '{"value":"retained"}',
    ...config,
  };
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(settings));
  const children = [];
  let opens = 0;
  const runtime = new Runtime({
    executablePath: process.execPath,
    maxActiveHelpers: 1,
    spawn(_executable, args, options) {
      const child = spawn(process.execPath, [ownPath, path, audit, ...args], options);
      children.push(child);
      return child;
    },
  });
  const provider = {
    async open(_deploymentId, address, wait) {
      opens += 1;
      const client = await runtime.open(address, wait).catch(async (error) => {
        await runtime.close();
        throw error;
      });
      return { client, expectedSourceProfileId: settings.sourceProfileId };
    },
    observation: () => runtime.observation(),
    close: () => runtime.close(),
  };
  const registry = new Registry({
    provider,
    environmentId: settings.environmentId,
    ...registryOptions,
  });
  const input = {
    address: "\\\\.\\pipe\\bycoda-authority-v1-" + randomBytes(16).toString("hex"),
    deploymentId: settings.sourceProfileId,
    registrationNonce: settings.registrationNonce,
    expectedHostEnvironmentId: settings.environmentId,
  };
  return {
    registry,
    provider,
    children,
    settings,
    input,
    get opens() {
      return opens;
    },
    audit: async () =>
      (await readFile(audit, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    async cleanup() {
      await registry.close();
      const target = await realpath(directory);
      if (
        dirname(target) !== (await realpath(evidence)) ||
        !basename(target).startsWith("fixture-")
      )
        throw new Error("Unsafe retained fixture cleanup");
      await rm(target, { recursive: true, force: true });
    },
  };
}

async function runChild() {
  const config = JSON.parse(await readFile(process.argv[2], "utf8"));
  const audit = process.argv[3];
  const mark = (event) => appendFileSync(audit, JSON.stringify(event) + "\n");
  const reply = (value) =>
    new Promise((done) => {
      const body = Buffer.from(JSON.stringify(value));
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length);
      process.stdout.write(Buffer.concat([prefix, body]), done);
    });
  const raw = Buffer.from(config.sourceJson);
  const scope = {
    environmentId: config.environmentId,
    sourceStoreId: config.sourceStoreId,
    sourceProfileId: config.sourceProfileId,
    sourceEpoch: config.sourceEpoch,
    writerProtocol: 2,
    qualified: false,
  };
  let bootstrap = true,
    hello = false,
    lastRequest = 0,
    result = null,
    active;
  let buffer = Buffer.alloc(0),
    serial = Promise.resolve();
  async function handle(command) {
    if (bootstrap) {
      bootstrap = false;
      await reply({ version: 1, kind: "ready" });
      return;
    }
    if (command.kind === "close") {
      mark({ kind: "helper-close" });
      await reply({ kind: "closed", id: command.id });
      await delay(config.exitDelay ?? 0);
      process.exit(0);
    }
    if (command.kind === "receive") {
      await reply({ kind: "received", id: command.id, value: result });
      return;
    }
    if (command.kind !== "send") process.exit(2);
    const value = command.value;
    mark(value);
    if (value.kind === "source-hello") {
      if (
        hello ||
        value.registrationNonce !== config.registrationNonce ||
        value.environmentId !== config.environmentId
      )
        process.exit(2);
      hello = true;
      result = {
        version: 1,
        kind: "source-hello-result",
        registrationNonce: config.registrationNonce,
        ...scope,
      };
    } else {
      if (!hello || value.sourceEpoch !== config.sourceEpoch || value.requestId <= lastRequest)
        process.exit(2);
      lastRequest = value.requestId;
      const common = {
        version: 1,
        requestId: lastRequest,
        sourceEpoch: config.sourceEpoch,
        qualified: false,
      };
      if (value.kind === "source-status") {
        result = { version: 1, kind: "source-status-result", requestId: lastRequest, ...scope };
      } else if (value.kind === "source-retained-open") {
        if (active) process.exit(2);
        if (config.openDelay) await delay(config.openDelay);
        result = {
          ...common,
          kind: "source-retained-open-result",
          sessionId: value.sessionId,
          migrationId: value.migrationId,
          state: config.absent ? "absent" : "retained",
        };
        if (!config.absent) {
          active = randomUUID();
          const fence = {
            environmentId: config.environmentId,
            sourceStoreId: config.sourceStoreId,
            sourceProfileId: config.sourceProfileId,
            sessionId: value.sessionId,
            migrationId: value.migrationId,
            protocol: 2,
            generation: 1,
            sourceRevision: 7,
            sourceDigest: config.badDigest
              ? "0".repeat(64)
              : createHash("sha256").update(raw).digest("hex"),
            snapshotEncoding: "source-json-utf8/v1",
            minWriterProtocol: 2,
            quiescent: true,
            unknownReservations: false,
            writerInventoryVerified: true,
            unsupportedWriters: false,
            evidenceDigest: "e".repeat(64),
            ...config.fenceChange,
          };
          Object.assign(result, {
            exportId: active,
            fence,
            totalBytes: raw.length,
            chunkBytes: 16384,
          });
        }
      } else if (value.kind === "source-retained-chunk") {
        if (config.disconnectChunk) process.exit(0);
        if (!active || value.exportId !== active) process.exit(2);
        if (config.chunkDelay) await delay(config.chunkDelay);
        result = {
          ...common,
          kind: "source-retained-chunk-result",
          exportId: active,
          offset: value.offset,
          data: raw.subarray(value.offset, value.offset + 16384).toString("base64"),
          eof: value.offset + 16384 >= raw.length,
          ...config.chunkChange,
        };
      } else if (value.kind === "source-retained-close") {
        if (!active || value.exportId !== active) process.exit(2);
        if (config.closeDelay) await delay(config.closeDelay);
        result = {
          ...common,
          kind: "source-retained-close-result",
          exportId: active,
          retired: true,
          ...config.closeChange,
        };
        active = undefined;
      } else process.exit(2);
    }
    await reply({ kind: "sent", id: command.id });
  }
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE();
      if (!length || length > 65536) process.exit(2);
      if (buffer.length < length + 4) return;
      const value = JSON.parse(buffer.subarray(4, length + 4).toString("utf8"));
      buffer = buffer.subarray(length + 4);
      serial = serial.then(() => handle(value)).catch(() => process.exit(2));
    }
  });
  process.stdin.on("end", () => {
    if (!hello) process.exit(0);
  });
}
if (process.argv[1] && resolve(process.argv[1]) === ownPath) await runChild();
