import { afterEach, describe, expect, it, vi } from "vitest";
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
      .mockResolvedValueOnce({ state: "unavailable" });
    const hosts = createTailnetServeHosts(read);
    expect(hosts.current()).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(hosts.current()).toEqual(["bab.tail1.ts.net"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hosts.current()).toEqual(["bab.tail1.ts.net"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hosts.current()).toEqual([]);
    hosts.dispose();
  });
});
