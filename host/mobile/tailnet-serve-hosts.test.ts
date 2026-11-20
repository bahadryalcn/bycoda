import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import { createTailnetServeHosts, tailnetServeHost } from "./tailnet-serve-hosts";

describe("tailnet serve hosts", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts only a ready https ts.net endpoint without credentials or port", () => {
    expect(tailnetServeHost({ state: "ready", endpoint: "https://Bab.tail12e784.ts.net" })).toBe(
      "bab.tail12e784.ts.net",
    );
    expect(
      tailnetServeHost({ state: "ready", endpoint: "http://bab.tail12e784.ts.net" }),
    ).toBeUndefined();
    expect(
      tailnetServeHost({ state: "ready", endpoint: "https://evil.example.com" }),
    ).toBeUndefined();
    expect(
      tailnetServeHost({ state: "ready", endpoint: "https://bab.tail1.ts.net:8443" }),
    ).toBeUndefined();
    expect(
      tailnetServeHost({ state: "ready", endpoint: "https://u:p@bab.tail1.ts.net" }),
    ).toBeUndefined();
    expect(
      tailnetServeHost({ state: "unavailable" as never, endpoint: "https://bab.tail1.ts.net" }),
    ).toBeUndefined();
  });

  it("learns the name in the background, refreshes it and keeps it when a probe fails", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockResolvedValueOnce({ state: "ready", endpoint: "https://bab.tail1.ts.net" })
      .mockRejectedValueOnce(new Error("cli busy"))
      .mockResolvedValueOnce({ state: "unavailable" })
      .mockResolvedValueOnce({ state: "permission-required" })
      .mockResolvedValueOnce({ state: "setup-required" });
    const hosts = createTailnetServeHosts(read);
    expect(hosts.current()).toEqual([]);
    expect(hosts.retryUnknownHost("bab.tail1.ts.net")).toBe(true);
    expect(hosts.retryUnknownHost("foreign.example.com")).toBe(false);
    expect(hosts.retryUnknownHost("bab.tail1.ts.net:8443")).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(hosts.current()).toEqual(["bab.tail1.ts.net"]);
    expect(hosts.retryUnknownHost("other.tail1.ts.net")).toBe(false);
    // A throw, `unavailable` (how a failed CLI call is reported) and a permission
    // problem are not proof that Serve stopped.
    for (let probe = 0; probe < 3; probe++) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(hosts.current()).toEqual(["bab.tail1.ts.net"]);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hosts.current()).toEqual([]);
    hosts.dispose();
  });

  it("takes a status the Host already read at once, only from a trusted ready endpoint", async () => {
    vi.useFakeTimers();
    const hosts = createTailnetServeHosts(async () => ({ state: "unavailable" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(hosts.current()).toEqual([]);
    // A foreign name, a port or a non-ready state never opens the allowlist.
    hosts.observe({ state: "ready", endpoint: "https://evil.example.com" });
    hosts.observe({ state: "ready", endpoint: "https://bab.tail1.ts.net:8443" });
    hosts.observe({ state: "unavailable" });
    expect(hosts.current()).toEqual([]);
    hosts.observe({ state: "ready", endpoint: "https://bab.tail1.ts.net" });
    expect(hosts.current()).toEqual(["bab.tail1.ts.net"]);
    hosts.observe({ state: "setup-required" });
    expect(hosts.current()).toEqual([]);
    hosts.dispose();
  });

  it("does not let a slower probe that started earlier undo a newer observed status", async () => {
    vi.useFakeTimers();
    let finish!: (status: MobileAccessStatus) => void;
    const read = vi.fn(
      () =>
        new Promise<MobileAccessStatus>((resolve) => {
          finish = resolve;
        }),
    );
    const hosts = createTailnetServeHosts(read);
    hosts.observe({ state: "ready", endpoint: "https://bab.tail1.ts.net" });
    finish({ state: "setup-required" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hosts.current()).toEqual(["bab.tail1.ts.net"]);
    hosts.dispose();
  });

  it("probes again after a refresh requested while a probe is already running", async () => {
    vi.useFakeTimers();
    const resolvers: ((status: MobileAccessStatus) => void)[] = [];
    const read = vi.fn(
      () =>
        new Promise<MobileAccessStatus>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const hosts = createTailnetServeHosts(read);
    // The creation probe ran before the Host listened and found nothing.
    hosts.refresh();
    hosts.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    resolvers[0]?.({ state: "unavailable" });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    resolvers[1]?.({ state: "ready", endpoint: "https://bab.tail1.ts.net" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hosts.current()).toEqual(["bab.tail1.ts.net"]);
    expect(read).toHaveBeenCalledTimes(2);
    hosts.dispose();
  });
});
