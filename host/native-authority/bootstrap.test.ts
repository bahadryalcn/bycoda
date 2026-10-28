import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request, type Server, type IncomingMessage } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { NativeAuthorityHelperRuntime } from "./helper-client";
import { NativeSourceRegistry } from "./source-registry";
import { sourceFixture } from "./fixtures/source-helper.mjs";
import { createNativeAuthorityBootstrap, NATIVE_AUTHORITY_BOOTSTRAP_PATH } from "./bootstrap";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(
  options: Partial<Omit<Parameters<typeof createNativeAuthorityBootstrap>[0], "secret">> = {},
) {
  const secret = randomBytes(32).toString("base64url");
  const handler = createNativeAuthorityBootstrap({
    secret,
    environmentId: options.registry?.environmentId ?? "actual-host-environment",
    ...options,
  });
  const server: Server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  cleanups.push(async () => {
    await handler.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const begin = (headers: Record<string, string> = {}, method = "POST") => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: NATIVE_AUTHORITY_BOOTSTRAP_PATH,
      method,
      headers: { Authorization: `Bearer ${secret}`, ...headers },
    });
    const result = new Promise<{ status: number; raw: string; cache: unknown }>(
      (resolve, reject) => {
        req.once("error", reject);
        req.once("response", (response) => {
          let raw = "";
          response.on("data", (chunk) => {
            raw += String(chunk);
          });
          response.once("end", () =>
            resolve({
              status: response.statusCode!,
              raw,
              cache: response.headers["cache-control"],
            }),
          );
          response.once("error", reject);
        });
      },
    );
    return { req, result };
  };
  const call = async (
    body: string | Buffer,
    headers: Record<string, string> = {},
    method = "POST",
  ) => {
    const { req, result } = begin(headers, method);
    req.end(body);
    return result;
  };
  const nextRequest = () =>
    new Promise<IncomingMessage>((resolve) => {
      server.once("request", (incoming) => resolve(incoming));
    });
  return { handler, call, begin, secret, nextRequest };
}

async function registeredFixture(options: Parameters<typeof sourceFixture>[0] = {}) {
  const source = await sourceFixture({
    Runtime: NativeAuthorityHelperRuntime,
    Registry: NativeSourceRegistry,
    ...options,
  });
  cleanups.push(() => source.cleanup());
  return source;
}
const action = (name: string, input: object = {}) =>
  JSON.stringify({ version: 1, action: name, ...input });
const reference = (association: { associationId: string; sourceEpoch: string }) => ({
  associationId: association.associationId,
  sourceEpoch: association.sourceEpoch,
});
const lookup = ({
  address: _address,
  ...input
}: {
  address: string;
  deploymentId: string;
  registrationNonce: string;
  expectedHostEnvironmentId: string;
}) => input;

describe("private native authority bootstrap", () => {
  it("releases an abruptly aborted body without an unhandled error or lost slot", async () => {
    const f = await fixture({ maxPending: 1, bodyTimeoutMs: 5_000 });
    const arrived = f.nextRequest();
    const held = f.begin();
    const disconnected = held.result.catch(() => undefined);
    held.req.write("{");
    const incoming = await arrived;
    const aborted = once(incoming, "aborted");
    held.req.destroy();
    await aborted;
    await disconnected;
    expect((await f.call('{"version":1,"action":"describe"}')).status).toBe(200);
  });
  it("returns only the actual Host environment and explicitly unqualified status", async () => {
    const f = await fixture();
    const result = await f.call('{"version":1,"action":"describe"}');
    expect(result.status).toBe(200);
    expect(result.cache).toBe("no-store");
    expect(JSON.parse(result.raw)).toEqual({
      version: 1,
      environmentId: "actual-host-environment",
      qualified: false,
    });
    expect(result.raw).not.toContain(f.secret);
  });

  it("rejects paired credentials, any Origin header, and other methods", async () => {
    const f = await fixture();
    for (const headers of [
      { Authorization: "Bearer paired-device-token" },
      { Origin: "https://example.test" },
      { Origin: "" },
    ]) {
      expect((await f.call('{"version":1,"action":"describe"}', headers)).status).toBe(403);
    }
    expect((await f.call("", {}, "GET")).status).toBe(403);
  });

  it("rejects a claimed environment, PID, executable, source, or authority action", async () => {
    const f = await fixture();
    for (const body of [
      { version: 1, action: "describe", environmentId: "forged" },
      { version: 1, action: "describe", pid: 123 },
      { version: 1, action: "describe", executable: "untrusted.exe" },
      { version: 1, action: "describe", sourceStoreId: "forged" },
      { version: 1, action: "activate" },
      { version: 2, action: "describe" },
    ])
      expect((await f.call(JSON.stringify(body))).status).toBe(400);
  });

  it("bounds bytes before parsing and rejects malformed UTF8 and JSON", async () => {
    const f = await fixture();
    expect((await f.call(Buffer.alloc(2049, 32))).status).toBe(413);
    expect((await f.call(Buffer.from([0xff]))).status).toBe(400);
    expect((await f.call("{")).status).toBe(400);
    expect((await f.call('{"version":1,"action":"describe"}')).status).toBe(200);
  });

  it("bounds concurrent incomplete requests until the accepted body actually ends", async () => {
    const f = await fixture({ maxPending: 1, bodyTimeoutMs: 5_000 });
    const arrived = f.nextRequest();
    const held = f.begin();
    held.req.write("{");
    await arrived;
    expect((await f.call('{"version":1,"action":"describe"}')).status).toBe(503);
    held.req.end("invalid");
    expect((await held.result).status).toBe(400);
    expect((await f.call('{"version":1,"action":"describe"}')).status).toBe(200);
  });

  it("bounds an abandoned body with a real response deadline", async () => {
    const f = await fixture({ bodyTimeoutMs: 50 });
    const held = f.begin();
    held.req.write("{");
    expect((await held.result).status).toBe(408);
    held.req.end();
    expect((await f.call('{"version":1,"action":"describe"}')).status).toBe(200);
  });

  it("shutdown rejects in-flight bodies and refuses new bootstrap admission", async () => {
    const f = await fixture();
    const arrived = f.nextRequest();
    const held = f.begin();
    held.req.write("{");
    await arrived;
    f.handler.close();
    expect((await held.result).status).toBe(503);
    expect((await f.call('{"version":1,"action":"describe"}')).status).toBe(503);
    held.req.end();
  });

  it("keeps registration unavailable without a configured trusted provider", async () => {
    const source = await registeredFixture();
    const f = await fixture();
    expect((await f.call(action("register-source", source.first.input))).status).toBe(503);
    expect((await f.call(action("lookup-source", lookup(source.first.input)))).status).toBe(503);
    expect(source.opens).toBe(0);
  });

  it("registers, reads actual scope and retires only an exact association", async () => {
    const source = await registeredFixture();
    const f = await fixture({ registry: source.registry });
    expect(JSON.parse((await f.call(action("describe"))).raw)).toEqual({
      version: 1,
      environmentId: "host-source-test",
      qualified: false,
      sourceRegistrationAvailable: true,
    });
    const registered = await f.call(action("register-source", source.first.input));
    expect(registered.status).toBe(200);
    const association = JSON.parse(registered.raw);
    expect(association).toMatchObject({
      sourceStoreId: source.first.config.sourceStoreId,
      sourceProfileId: source.first.config.sourceProfileId,
      writerProtocol: 2,
      qualified: false,
    });
    expect(association).not.toHaveProperty("address");
    expect(association).not.toHaveProperty("registrationNonce");
    const before = (await source.audit()).length;
    expect(
      JSON.parse((await f.call(action("lookup-source", lookup(source.first.input)))).raw),
    ).toEqual({ version: 1, state: "associated", association, qualified: false });
    expect(await source.audit()).toHaveLength(before);
    expect(JSON.parse((await f.call(action("source-status", reference(association)))).raw)).toEqual(
      association,
    );
    expect(
      (
        await f.call(
          action("unregister-source", { ...reference(association), sourceEpoch: randomUUID() }),
        )
      ).status,
    ).toBe(409);
    expect(source.registry.observation().sources).toBe(1);
    expect(
      JSON.parse((await f.call(action("unregister-source", reference(association)))).raw),
    ).toEqual({ version: 1, ...reference(association), retired: true, qualified: false });
    expect(source.provider.observation().activeHelpers).toBe(0);
  });

  it("guards source actions before provider access and rejects extra claimed authority", async () => {
    const source = await registeredFixture();
    const f = await fixture({ registry: source.registry });
    const body = action("register-source", source.first.input);
    for (const headers of [{ Authorization: "Bearer paired-device-token" }, { Origin: "" }])
      expect((await f.call(body, headers)).status).toBe(403);
    for (const extra of [
      { pid: process.pid },
      { executablePath: process.execPath },
      { sourceProfileId: randomUUID() },
      { qualified: true },
      { provisioningLauncher: { nodeExecutable: process.execPath, entryPath: process.execPath } },
    ]) {
      expect(
        (await f.call(action("register-source", { ...source.first.input, ...extra }))).status,
      ).toBe(400);
    }
    expect(
      (
        await f.call(
          action("register-source", {
            ...source.first.input,
            expectedHostEnvironmentId: "wrong-host",
          }),
        )
      ).status,
    ).toBe(409);
    expect(source.opens).toBe(0);
  });

  it("recovers a timed-out registration ACK through memory-only lookup with no resend", async () => {
    const source = await registeredFixture();
    const release = source.hold();
    const f = await fixture({ registry: source.registry, bodyTimeoutMs: 60, maxPending: 2 });
    expect((await f.call(action("register-source", source.first.input))).status).toBe(408);
    expect(source.opens).toBe(1);
    expect(
      JSON.parse((await f.call(action("lookup-source", lookup(source.first.input)))).raw),
    ).toEqual({ version: 1, state: "pending", qualified: false });
    release();
    await vi.waitFor(() =>
      expect(source.registry.lookup(lookup(source.first.input)).state).toBe("associated"),
    );
    const recovered = JSON.parse(
      (await f.call(action("lookup-source", lookup(source.first.input)))).raw,
    );
    expect(recovered).toMatchObject({
      state: "associated",
      association: { sourceProfileId: source.first.config.sourceProfileId, qualified: false },
      qualified: false,
    });
    expect(source.opens).toBe(1);
    expect((await source.audit()).filter((event) => event.kind === "source-hello")).toHaveLength(1);
  });

  it("retains timed-out accepted HTTP admission until actual registration settlement", async () => {
    const source = await registeredFixture();
    const release = source.hold();
    const f = await fixture({ registry: source.registry, bodyTimeoutMs: 60, maxPending: 1 });
    expect((await f.call(action("register-source", source.first.input))).status).toBe(408);
    expect((await f.call(action("describe"))).status).toBe(503);
    release();
    await vi.waitFor(() => expect(source.registry.observation().acceptedOperations).toBe(0));
    expect((await f.call(action("describe"))).status).toBe(200);
    expect(source.registry.lookup(lookup(source.first.input)).state).toBe("associated");
  });

  it("retains an accepted registration after HTTP disconnect without treating it as cancellation", async () => {
    const source = await registeredFixture();
    const release = source.hold();
    const f = await fixture({ registry: source.registry, bodyTimeoutMs: 5_000, maxPending: 1 });
    const held = f.begin();
    const disconnected = held.result.catch(() => undefined);
    held.req.end(action("register-source", source.first.input));
    await vi.waitFor(() => expect(source.opens).toBe(1));
    held.req.destroy();
    await disconnected;
    expect((await f.call(action("describe"))).status).toBe(503);
    release();
    await vi.waitFor(() => expect(source.registry.observation().acceptedOperations).toBe(0));
    expect((await f.call(action("describe"))).status).toBe(200);
    expect(source.registry.lookup(lookup(source.first.input)).state).toBe("associated");
    expect(source.opens).toBe(1);
  });

  it("holds shutdown through an accepted provider await and refuses replacement admission", async () => {
    const source = await registeredFixture();
    const release = source.hold();
    const f = await fixture({ registry: source.registry, bodyTimeoutMs: 5_000 });
    const result = f.call(action("register-source", source.first.input));
    await vi.waitFor(() => expect(source.opens).toBe(1));
    let closed = false;
    const close = f.handler.close().then(() => {
      closed = true;
    });
    expect((await result).status).toBe(503);
    await new Promise((done) => setTimeout(done, 20));
    expect(closed).toBe(false);
    expect((await f.call(action("describe"))).status).toBe(503);
    release();
    await close;
    expect(source.registry.observation()).toMatchObject({
      sources: 0,
      acceptedOperations: 0,
      activeHelpers: 0,
    });
  });

  it("exposes only an immutable configured local provisioning launcher", async () => {
    const launcher = { nodeExecutable: process.execPath, entryPath: process.execPath };
    const f = await fixture({ provisioningLauncher: launcher });
    launcher.nodeExecutable = "caller-mutated";
    expect(JSON.parse((await f.call(action("describe"))).raw)).toEqual({
      version: 1,
      environmentId: "actual-host-environment",
      qualified: false,
      provisioningLauncher: { nodeExecutable: process.execPath, entryPath: process.execPath },
    });
    expect((await f.call(action("describe", { provisioningLauncher: launcher }))).status).toBe(400);
    expect(() =>
      createNativeAuthorityBootstrap({
        secret: f.secret,
        environmentId: "host",
        provisioningLauncher: { nodeExecutable: "relative", entryPath: process.execPath },
      }),
    ).toThrow("Invalid native provisioning launcher");
  });
});
