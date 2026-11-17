import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLanIdentity } from "./mobile-lan-crypto";
import { MobileLanAccess, type MobileLanTlsOptions } from "./mobile-lan";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

function listener(savedPort: number, code?: string, failEphemeral = false) {
  const server = createServer();
  let port: number | undefined;
  const listen = vi.spyOn(server, "listen").mockImplementation((...args: unknown[]) => {
    const requested = args[0] as number;
    if (code && (requested === savedPort || failEphemeral)) {
      queueMicrotask(() => server.emit("error", Object.assign(new Error(code), { code })));
    } else {
      port = requested || savedPort + 10;
      (args.at(-1) as () => void)();
    }
    return server;
  });
  vi.spyOn(server, "address").mockImplementation(() =>
    port ? { address: "192.168.2.108", port, family: "IPv4" } : null,
  );
  vi.spyOn(server, "close").mockImplementation((callback) => {
    port = undefined;
    callback?.();
    return server;
  });
  return { server, listen };
}

async function fixture(plainCode?: string, tlsCode?: string, failEphemeral = false) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-lan-recovery-"));
  const file = join(directory, "mobile-lan.json");
  const key = createLanIdentity().encoded;
  await writeFile(
    file,
    JSON.stringify({ key, enabled: true, address: "192.168.2.108", port: 63888, tlsPort: 64749 }),
  );
  const plain = listener(63888, plainCode, failEphemeral);
  const secure = listener(64749, tlsCode, failEphemeral);
  const bootstrap = vi.fn(async (address: string, port: number) => ({
    endpoint: `wss://${address}:${port}/ws`,
  }));
  const access = new MobileLanAccess(
    file,
    "pc",
    () => 3776,
    () => ["192.168.95.2", "192.168.2.108"],
    () => plain.server,
    {
      tlsAuthority: {
        environmentId: "pc",
        issue: async () => ({ expiresAt: Date.now() + 3600000 }),
        bootstrap,
      },
      makeWssGateway: () => secure.server,
    } as unknown as MobileLanTlsOptions,
  );
  cleanups.push(async () => {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { access, file, plain, secure, bootstrap, key };
}

it.each(["plain", "tls", "both"])(
  "replaces EACCES saved %s ports, persists them and preserves identity",
  async (target) => {
    const f = await fixture(
      target !== "tls" ? "EACCES" : undefined,
      target !== "plain" ? "EACCES" : undefined,
    );
    await f.access.start();
    const status = await f.access.status();
    expect(status).toMatchObject({
      state: "ready",
      addresses: ["192.168.2.108", "192.168.95.2"],
      reason: "Mobile address changed. Reconnect paired devices using the new endpoint.",
    });
    const saved = JSON.parse(await readFile(f.file, "utf8"));
    expect(saved).toMatchObject({
      key: f.key,
      enabled: true,
      port: target !== "tls" ? 63898 : 63888,
      tlsPort: target !== "plain" ? 64759 : 64749,
    });
    expect(f.bootstrap).toHaveBeenCalledWith("192.168.2.108", saved.tlsPort);
    expect(f.plain.listen.mock.calls.map((call) => call[0])).toEqual(
      target !== "tls" ? [63888, 0] : [63888],
    );
    expect(f.secure.listen.mock.calls.map((call) => call[0])).toEqual(
      target !== "plain" ? [64749, 0] : [64749],
    );
  },
);

it.each(["plain", "tls"])("never replaces EADDRINUSE saved %s port", async (target) => {
  const f = await fixture(
    target === "plain" ? "EADDRINUSE" : undefined,
    target === "tls" ? "EADDRINUSE" : undefined,
  );
  await f.access.start();
  expect(await f.access.status()).toMatchObject({
    state: "unavailable",
    reason: "The saved mobile port is in use. Free it and retry.",
  });
  expect((target === "plain" ? f.plain : f.secure).listen).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(f.file, "utf8"))).toMatchObject({ port: 63888, tlsPort: 64749 });
});

it.each([
  [
    "EACCES",
    "The mobile port is blocked by Windows or system policy. Choose another port or check network permissions.",
  ],
  [
    "EADDRNOTAVAIL",
    "The selected mobile address is no longer available. Choose an active network and retry.",
  ],
  ["UNKNOWN", "Mobile LAN access could not start. Check the selected network and retry."],
])("explains %s failures without changing saved state", async (code, reason) => {
  const f = await fixture(code, undefined, true);
  await f.access.start();
  expect(await f.access.status()).toMatchObject({ state: "unavailable", reason });
  expect(JSON.parse(await readFile(f.file, "utf8"))).toMatchObject({ port: 63888, tlsPort: 64749 });
});
