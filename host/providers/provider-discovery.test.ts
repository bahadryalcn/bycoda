import { describe, expect, it } from "vitest";
import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "../../src/features/connections/model/protocol";
import { PROVIDER_DISCOVERY_CONCURRENCY, discoverAvailableProviders } from "./provider-discovery";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("discoverAvailableProviders", () => {
  it("probes providers concurrently, never above the cap, and each exactly once", async () => {
    let active = 0;
    let peak = 0;
    const calls: RemoteProvider[] = [];
    const available = await discoverAvailableProviders(async (provider) => {
      calls.push(provider);
      active += 1;
      peak = Math.max(peak, active);
      await flush();
      active -= 1;
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(PROVIDER_DISCOVERY_CONCURRENCY);
    expect([...calls].sort()).toEqual(REMOTE_PROVIDERS.filter((p) => p !== "acp").sort());
    expect(new Set(calls).size).toBe(calls.length);
    expect(available).toEqual(REMOTE_PROVIDERS.filter((p) => p !== "acp"));
  });

  it("keeps registry order when probes finish out of order", async () => {
    const delays: Partial<Record<RemoteProvider, number>> = { codex: 20, claude: 0, cursor: 5 };
    const available = await discoverAvailableProviders(
      (provider) => new Promise((resolve) => setTimeout(resolve, delays[provider] ?? 0)),
      ["codex", "claude", "cursor", "grok"],
    );
    expect(available).toEqual(["codex", "claude", "cursor", "grok"]);
  });

  it("omits providers that fail without failing or cancelling the others", async () => {
    const seen: RemoteProvider[] = [];
    const available = await discoverAvailableProviders(async (provider) => {
      seen.push(provider);
      if (provider === "claude" || provider === "grok") throw new Error("not installed");
    });
    expect(available).not.toContain("claude");
    expect(available).not.toContain("grok");
    expect(available).toContain("codex");
    expect(available).toContain("hermes");
    expect(seen).toHaveLength(REMOTE_PROVIDERS.length - 1);
  });

  it("never probes the generic acp adapter and resolves only after every probe settled", async () => {
    let settled = 0;
    const seen: RemoteProvider[] = [];
    const available = await discoverAvailableProviders(async (provider) => {
      seen.push(provider);
      await flush();
      settled += 1;
    });
    expect(seen).not.toContain("acp");
    expect(available).not.toContain("acp");
    expect(settled).toBe(seen.length);
  });

  it("is serial when the concurrency is one", async () => {
    let active = 0;
    let peak = 0;
    await discoverAvailableProviders(
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await flush();
        active -= 1;
      },
      REMOTE_PROVIDERS,
      1,
    );
    expect(peak).toBe(1);
  });
});
