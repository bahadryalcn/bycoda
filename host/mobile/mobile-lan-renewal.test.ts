import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MobileLanAccess, type createLanGateway } from "./mobile-lan";
import type { MobileTlsAuthority, MobileTlsMaterial } from "../security/mobile-tls";
import type { createMobileWssGateway } from "../security/mobile-wss";
const HOUR = 3_600_000;
// A live owner has one interface monitor and one TLS renewal timer. Hung
// issuance retains only the monitor; close/disable must retire both.
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(Date.parse("2026-11-04T12:00:00Z"));
});
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function material(overrides: Partial<MobileTlsMaterial> = {}): MobileTlsMaterial {
  return {
    privateKeyPem: "fixture-key",
    certificatePem: "fixture-leaf",
    caCertificatePem: "fixture-ca",
    caGeneration: 1,
    caSpkiPin: "sha256/fixture",
    expiresAt: Date.now() + 10 * HOUR,
    ...overrides,
  };
}
function listener(port: number) {
  const server = createServer();
  let listening = false;
  const context = vi.fn();
  Object.assign(server, { setSecureContext: context });
  const listen = vi.spyOn(server, "listen").mockImplementation((...args: unknown[]) => {
    listening = true;
    (args.at(-1) as () => void)();
    return server;
  });
  vi.spyOn(server, "address").mockImplementation(() =>
    listening ? { address: "192.168.1.20", port, family: "IPv4" } : null,
  );
  const close = vi.spyOn(server, "close").mockImplementation((callback) => {
    listening = false;
    callback?.();
    return server;
  });
  const closeAll = vi.spyOn(server, "closeAllConnections").mockImplementation(() => {});
  return { server, context, listen, close, closeAll };
}
async function fixture(initial = material(), failInitialStatus = false) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-lan-renewal-"));
  const file = join(directory, "mobile-lan.json");
  const plain: ReturnType<typeof listener>[] = [];
  const secure: ReturnType<typeof listener>[] = [];
  const issue = vi.fn(async () => initial);
  const bootstrap = {
    version: 1 as const,
    environmentId: "pc",
    caGeneration: 1,
    caCertificatePem: initial.caCertificatePem,
    caSpkiPin: initial.caSpkiPin,
    endpoint: "wss://192.168.1.20:43211/ws",
    bulkBaseUrl: "https://192.168.1.20:43211/ws-bulk/",
  };
  const authority = {
    environmentId: "pc",
    issue,
    bootstrap: vi.fn(async () => bootstrap),
  } as unknown as MobileTlsAuthority;
  const makePlain = vi.fn(() => {
    const entry = listener(43210);
    plain.push(entry);
    return entry.server;
  });
  const makeSecure = vi.fn(() => {
    const entry = listener(43211);
    secure.push(entry);
    return entry.server;
  });
  let addressReads = 0;
  const access = new MobileLanAccess(
    file,
    "pc",
    () => 3776,
    () => {
      if (++addressReads === 2 && failInitialStatus) throw new Error("address status unavailable");
      return ["192.168.1.20"];
    },
    makePlain as typeof createLanGateway,
    {
      tlsAuthority: authority,
      makeWssGateway: makeSecure as unknown as typeof createMobileWssGateway,
    },
  );
  cleanups.push(async () => {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  });
  const enabled = await access.enable();
  if (failInitialStatus) expect(enabled.state).toBe("unavailable");
  else expect(enabled).toMatchObject({ state: "ready", tls: bootstrap });
  return { access, issue, plain, secure, makePlain, makeSecure, file, bootstrap };
}

it("clears renewal ownership when setup fails after listener publication", async () => {
  const f = await fixture(material(), true);
  // Saved enable intent retains its interface monitor; failed publication must
  // retire the certificate renewal owner and both listeners.
  expect(vi.getTimerCount()).toBe(1);
  expect(f.issue).toHaveBeenCalledOnce();
  expect(f.secure[0].close).toHaveBeenCalledOnce();
  expect(f.plain[0].close).toHaveBeenCalledOnce();
  const failed = await f.access.status();
  expect(failed).toMatchObject({
    state: "unavailable",
    reason: "Mobile LAN access could not start. Check the selected network and retry.",
  });
  expect(failed.endpoint).toBeUndefined();
  expect(failed.tls).toBeUndefined();
  await f.access.enable();
  expect(f.makeSecure).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(2);
});

it("retains the listener/certificate after one failure and renews in place on the same saved port", async () => {
  const f = await fixture();
  const saved = await readFile(f.file, "utf8");
  const current = f.secure[0];
  f.issue.mockRejectedValueOnce(new Error("temporary issuance failure"));
  await vi.advanceTimersByTimeAsync(HOUR);
  expect(await f.access.status()).toMatchObject({ tls: f.bootstrap });
  expect(current.close).not.toHaveBeenCalled();
  expect(current.closeAll).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(2);
  expect(current.server.listenerCount("error")).toBe(1);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(f.issue).toHaveBeenCalledTimes(2);
  const renewed = material({ privateKeyPem: "renewed-key", certificatePem: "renewed-leaf" });
  f.issue.mockResolvedValueOnce(renewed);
  await vi.advanceTimersByTimeAsync(1);
  expect(current.context).toHaveBeenCalledExactlyOnceWith({
    key: renewed.privateKeyPem,
    cert: renewed.certificatePem + renewed.caCertificatePem,
  });
  expect(await f.access.status()).toMatchObject({ tls: f.bootstrap });
  expect(await readFile(f.file, "utf8")).toBe(saved);
  expect(f.makePlain).toHaveBeenCalledOnce();
  expect(f.makeSecure).toHaveBeenCalledOnce();
  expect(current.listen).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(2);
});

it("does not install renewal on a changed port or infer retirement from an unknown binding read", async () => {
  const f = await fixture();
  const server = f.secure[0];
  vi.mocked(server.server.address).mockImplementationOnce(() => {
    throw new Error("address read unavailable");
  });
  await vi.advanceTimersByTimeAsync(HOUR);
  expect(server.context).not.toHaveBeenCalled();
  expect(server.close).not.toHaveBeenCalled();
  vi.mocked(server.server.address).mockReturnValue({
    address: "192.168.1.20",
    port: 49999,
    family: "IPv4",
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(server.context).not.toHaveBeenCalled();
  expect((await f.access.status()).tls).toBeUndefined();
  expect(server.listen).toHaveBeenCalledOnce();
  expect(server.close).not.toHaveBeenCalled();
  vi.mocked(server.server.address).mockReturnValue({
    address: "192.168.1.20",
    port: 43211,
    family: "IPv4",
  });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(server.context).toHaveBeenCalledOnce();
  expect(await f.access.status()).toMatchObject({ tls: f.bootstrap });
  expect(JSON.parse(await readFile(f.file, "utf8")).tlsPort).toBe(43211);
});

it("uses capped exponential retry and resets to hourly polling after recovery", async () => {
  const f = await fixture();
  f.issue.mockRejectedValue(new Error("unavailable"));
  await vi.advanceTimersByTimeAsync(HOUR);
  for (const delay of [60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, HOUR, HOUR]) {
    const calls = f.issue.mock.calls.length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(f.issue).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.issue).toHaveBeenCalledTimes(calls + 1);
    expect(vi.getTimerCount()).toBe(2);
  }
  f.issue.mockResolvedValue(material());
  await vi.advanceTimersByTimeAsync(HOUR);
  const calls = f.issue.mock.calls.length;
  await vi.advanceTimersByTimeAsync(HOUR - 1);
  expect(f.issue).toHaveBeenCalledTimes(calls);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.issue).toHaveBeenCalledTimes(calls + 1);
  expect(f.secure[0].close).not.toHaveBeenCalled();
});

it("keeps a hung issuance single-flight, hides expired TLS and restores the original endpoint after settlement", async () => {
  const f = await fixture(material({ expiresAt: Date.now() + HOUR + 30_000 }));
  const pending = Promise.withResolvers<MobileTlsMaterial>();
  f.issue.mockReturnValueOnce(pending.promise);
  await vi.advanceTimersByTimeAsync(HOUR);
  await vi.advanceTimersByTimeAsync(3 * HOUR);
  expect(f.issue).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);
  expect((await f.access.status()).tls).toBeUndefined();
  await f.access.enable();
  expect(f.issue).toHaveBeenCalledTimes(2);
  pending.resolve(material({ certificatePem: "late-valid-leaf" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(await f.access.status()).toMatchObject({ tls: f.bootstrap });
  expect(f.secure[0].context).toHaveBeenCalledOnce();
  expect(f.secure[0].close).not.toHaveBeenCalled();
  expect(f.secure[0].listen).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(2);
});

it.each(["close", "disable"] as const)(
  "fences late renewal after %s and leaves no timer or listener restart",
  async (operation) => {
    const f = await fixture();
    const pending = Promise.withResolvers<MobileTlsMaterial>();
    f.issue.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(HOUR);
    await f.access[operation]();
    if (operation === "close") pending.reject(new Error("late issuance failure"));
    else pending.resolve(material());
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(f.secure[0].context).not.toHaveBeenCalled();
    expect(f.secure[0].close).toHaveBeenCalledOnce();
    expect(f.makeSecure).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    if (operation === "disable") {
      expect(JSON.parse(await readFile(f.file, "utf8")).enabled).toBe(false);
      f.issue.mockResolvedValue(material());
      await f.access.enable();
      expect(f.makeSecure).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(2);
    }
  },
);

it("does not let an old in-flight renewal replace a newly enabled owner or its timer", async () => {
  const f = await fixture();
  const pending = Promise.withResolvers<MobileTlsMaterial>();
  f.issue.mockReturnValueOnce(pending.promise);
  await vi.advanceTimersByTimeAsync(HOUR);
  await f.access.disable();
  f.issue.mockResolvedValue(material({ certificatePem: "new-owner-leaf" }));
  await f.access.enable();
  expect(f.makeSecure).toHaveBeenCalledTimes(2);
  expect(f.secure[1].listen).toHaveBeenCalledWith(43211, "192.168.1.20", expect.any(Function));
  expect(vi.getTimerCount()).toBe(2);
  pending.resolve(material({ certificatePem: "old-owner-late-leaf" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.secure[0].context).not.toHaveBeenCalled();
  expect(f.secure[1].context).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(2);
  expect(await f.access.status()).toMatchObject({ tls: f.bootstrap });
});

it.each(["pin", "generation", "certificate", "expired", "context"] as const)(
  "retains the old valid context after a %s failure",
  async (fault) => {
    const f = await fixture();
    const server = f.secure[0];
    const changed = material(
      fault === "pin"
        ? { caSpkiPin: "sha256/changed" }
        : fault === "generation"
          ? { caGeneration: 2 }
          : fault === "certificate"
            ? { caCertificatePem: "different-ca-certificate" }
            : fault === "expired"
              ? { expiresAt: Date.now() + HOUR }
              : {},
    );
    f.issue.mockResolvedValueOnce(changed);
    if (fault === "context")
      server.context.mockImplementationOnce(() => {
        throw new Error("invalid context");
      });
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(await f.access.status()).toMatchObject({ tls: f.bootstrap });
    expect(server.close).not.toHaveBeenCalled();
    if (fault !== "context") expect(server.context).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await f.access.status()).toMatchObject({ tls: f.bootstrap });
    expect(server.close).not.toHaveBeenCalled();
    expect(server.listen).toHaveBeenCalledOnce();
  },
);
