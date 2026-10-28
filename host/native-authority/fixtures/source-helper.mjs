// Real Node child fixture for the registry; no native pipe/Store/actor proof.
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ownPath = fileURLToPath(import.meta.url);
const evidence = resolve("temp/verification/2026-10-28-native-source-registry");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** Parent-test composition passes real runtime/registry constructors explicitly. */
export async function sourceFixture({
  Runtime,
  Registry,
  registryOptions = {},
  config: defaults = {},
}) {
  await mkdir(evidence, { recursive: true });
  const directory = await mkdtemp(join(evidence, "fixture-"));
  const auditPath = join(directory, "audit.jsonl");
  const endpoints = new Map();
  const runtimes = new Set();
  const pending = new Set();
  const children = [];
  const releases = [];
  let gate;
  let closing = false;
  let opens = 0;
  const provider = {
    open(deploymentId, address, wait) {
      opens += 1;
      const operation = (async () => {
        if (gate) await gate;
        if (closing)
          throw Object.assign(new Error("unavailable"), { code: "DEPLOYMENT_UNAVAILABLE" });
        const endpoint = endpoints.get(address);
        if (
          !endpoint ||
          endpoint.input.deploymentId !== deploymentId ||
          endpoint.config.unavailable
        ) {
          throw Object.assign(new Error("unavailable"), { code: "DEPLOYMENT_UNAVAILABLE" });
        }
        const runtime = new Runtime({
          executablePath: process.execPath,
          maxActiveHelpers: 1,
          spawn(_executable, args, options) {
            const child = spawn(
              process.execPath,
              [ownPath, endpoint.path, auditPath, ...args],
              options,
            );
            children.push(child);
            return child;
          },
        });
        runtimes.add(runtime);
        try {
          const client = await runtime.open(address, wait);
          return {
            client,
            expectedSourceProfileId:
              endpoint.config.expectedProfile ?? endpoint.config.sourceProfileId,
          };
        } catch (error) {
          await runtime.close();
          throw error;
        }
      })();
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      return operation;
    },
    observation: () => ({
      activeHelpers: [...runtimes].reduce(
        (sum, runtime) => sum + runtime.observation().activeHelpers,
        0,
      ),
    }),
    async close() {
      closing = true;
      await Promise.all([...runtimes].map((runtime) => runtime.close()));
      await Promise.allSettled(pending);
      await Promise.all([...runtimes].map((runtime) => runtime.close()));
    },
  };
  const registry = new Registry({
    provider,
    environmentId: "host-source-test",
    ...registryOptions,
  });
  const endpoint = async (extra = {}) => {
    const config = {
      environmentId: "host-source-test",
      sourceStoreId: randomUUID(),
      sourceProfileId: randomUUID(),
      sourceEpoch: randomUUID(),
      registrationNonce: randomUUID(),
      writerProtocol: 2,
      ...defaults,
      ...extra,
    };
    const address = "\\\\.\\pipe\\bycoda-authority-v1-" + randomBytes(16).toString("hex");
    const input = {
      deploymentId: config.sourceProfileId,
      address,
      registrationNonce: config.registrationNonce,
      expectedHostEnvironmentId: "host-source-test",
    };
    const path = join(directory, `${randomUUID()}.json`);
    await writeFile(path, JSON.stringify(config));
    const value = { input, config, path };
    endpoints.set(address, value);
    return value;
  };
  const first = await endpoint();
  return {
    registry,
    provider,
    first,
    endpoint,
    children,
    get opens() {
      return opens;
    },
    hold() {
      let release;
      gate = new Promise((done) => {
        release = () => {
          gate = undefined;
          done();
        };
      });
      releases.push(release);
      return release;
    },
    audit: async () =>
      (await readFile(auditPath, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    async cleanup() {
      releases.splice(0).forEach((release) => release());
      await registry.close();
      const target = await realpath(directory);
      if (
        dirname(target) !== (await realpath(evidence)) ||
        !basename(target).startsWith("fixture-")
      )
        throw new Error("Unsafe source fixture cleanup");
      await rm(target, { recursive: true, force: true });
    },
  };
}

async function runChild() {
  const config = JSON.parse(await readFile(process.argv[2], "utf8"));
  const audit = process.argv[3];
  const mark = (event) => appendFileSync(audit, JSON.stringify(event) + "\n");
  const frame = (value) => {
    const body = Buffer.from(JSON.stringify(value));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(body.length);
    return Buffer.concat([prefix, body]);
  };
  const reply = (value) => new Promise((done) => process.stdout.write(frame(value), done));
  const scope = () => ({
    environmentId: config.environmentId,
    sourceStoreId: config.sourceStoreId,
    sourceProfileId: config.sourceProfileId,
    sourceEpoch: config.sourceEpoch,
    writerProtocol: config.writerProtocol,
    qualified: false,
  });
  let buffer = Buffer.alloc(0);
  let bootstrap = true;
  let hello = false;
  let result = null;
  let requestId = 0;
  let serial = Promise.resolve();
  async function handle(command) {
    if (bootstrap) {
      bootstrap = false;
      await reply({ version: 1, kind: "ready" });
      return;
    }
    if (command.kind === "close") {
      mark({ kind: "closed" });
      await reply({ kind: "closed", id: command.id });
      await delay(config.exitDelay ?? 0);
      process.exit(0);
    }
    if (command.kind === "send") {
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
          ...scope(),
        };
        if (config.helloDelay) await delay(config.helloDelay);
        if (config.helloChange) Object.assign(result, config.helloChange);
      } else if (value.kind === "source-status") {
        if (!hello || value.sourceEpoch !== config.sourceEpoch || value.requestId <= requestId)
          process.exit(2);
        requestId = value.requestId;
        if (config.statusDelay) await delay(config.statusDelay);
        result = { version: 1, kind: "source-status-result", requestId, ...scope() };
        if (config.statusChange) Object.assign(result, config.statusChange);
        if (config.disconnectStatus) process.exit(0);
      } else process.exit(2);
      await reply({ kind: "sent", id: command.id });
    } else if (command.kind === "receive")
      await reply({ kind: "received", id: command.id, value: result });
    else process.exit(2);
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
