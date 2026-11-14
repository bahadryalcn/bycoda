import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import { createMobileRoutes } from "./mobile-routes";

const lanReady: MobileAccessStatus = {
  state: "ready",
  mode: "lan",
  endpoint: "http://192.168.2.108:41000",
  lanKey: "a".repeat(64),
};
const tailnetReady: MobileAccessStatus = {
  state: "ready",
  endpoint: "https://mini.tail1234.ts.net:8443",
};

afterEach(() => vi.useRealTimers());

describe("createMobileRoutes", () => {
  it("retries a failed slow probe one minute after it settles", async () => {
    vi.useFakeTimers();
    let fail!: (reason: Error) => void;
    const tailscale = vi
      .fn<() => Promise<MobileAccessStatus>>()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(tailnetReady);
    const routes = createMobileRoutes({ lan: async () => lanReady, tailscale });
    const first = routes();
    await vi.advanceTimersByTimeAsync(250);
    expect(await first).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120_000);
    fail(new Error("Tailscale status timed out"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await routes()).toHaveLength(1);
    expect(tailscale).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(await routes()).toHaveLength(1);
    expect(tailscale).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await routes()).toContainEqual({ endpoint: tailnetReady.endpoint });
    expect(tailscale).toHaveBeenCalledTimes(2);
  });

  it("answers discovery while Tailscale is stalled and reuses its late result", async () => {
    vi.useFakeTimers();
    let finish!: (value: MobileAccessStatus) => void;
    const tailscale = vi.fn(
      () =>
        new Promise<MobileAccessStatus>((resolve) => {
          finish = resolve;
        }),
    );
    const routes = createMobileRoutes({ lan: async () => lanReady, tailscale });
    const pending = routes();
    await vi.advanceTimersByTimeAsync(250);
    const observed = vi.fn();
    void pending.then(observed);
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toHaveBeenCalledWith([
      { endpoint: lanReady.endpoint, lanKey: lanReady.lanKey },
    ]);
    const later = routes();
    await vi.advanceTimersByTimeAsync(60_000);
    const stillWaiting = routes();
    await vi.advanceTimersByTimeAsync(250);
    expect(tailscale).toHaveBeenCalledOnce();
    finish(tailnetReady);
    await Promise.all([later, stillWaiting]);
    expect(await routes()).toContainEqual({ endpoint: tailnetReady.endpoint });
  });
  it("advertises the local listener with its public key and the Tailscale endpoint", async () => {
    const routes = createMobileRoutes({
      lan: async () => lanReady,
      tailscale: async () => tailnetReady,
    });
    expect(await routes()).toEqual([
      { endpoint: "http://192.168.2.108:41000", lanKey: "a".repeat(64) },
      { endpoint: "https://mini.tail1234.ts.net:8443" },
    ]);
  });

  it("leaves out routes that are not ready or fail", async () => {
    const routes = createMobileRoutes({
      lan: async () => ({ state: "setup-required", mode: "lan" }),
      tailscale: async () => {
        throw new Error("tailscale missing");
      },
    });
    expect(await routes()).toEqual([]);
  });

  it("asks Tailscale at most once a minute", async () => {
    vi.useFakeTimers();
    const tailscale = vi.fn(async () => tailnetReady);
    const routes = createMobileRoutes({ lan: async () => lanReady, tailscale });
    await routes();
    await routes();
    expect(tailscale).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await routes();
    expect(tailscale).toHaveBeenCalledTimes(2);
  });
});
