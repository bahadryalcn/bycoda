import { describe, expect, it, vi } from "vitest";
import {
  createProviderAccountStatusCache,
  withProviderAccountStatus,
} from "./provider-account-status";

const catalog = {
  claude: [
    { id: "default", label: "Host default", color: "#a" },
    { id: "work", label: "work", color: "#b" },
    { id: "old", label: "Claude account 3", color: "#c" },
  ],
  grok: [{ id: "default", label: "Host default", color: "#d" }],
};

describe("provider account status", () => {
  it("omits signed-out accounts and marks the rest", async () => {
    const probe = vi.fn(async (_provider: string, id: string) =>
      id === "old"
        ? ("signedOut" as const)
        : id === "work"
          ? ("signedIn" as const)
          : ("unknown" as const),
    );
    const cache = createProviderAccountStatusCache({ probe });
    const result = withProviderAccountStatus(catalog, await cache.read(catalog));
    expect(
      result.claude?.map((account) => [account.id, (account as { status?: string }).status]),
    ).toEqual([
      ["default", "unknown"],
      ["work", "ready"],
    ]);
    expect(result.grok).toEqual(catalog.grok);
  });

  it("serves the cached result until it is stale and keeps the last definitive status", async () => {
    let clock = 0;
    let next: "signedIn" | "unknown" = "signedIn";
    const probe = vi.fn(async () => next);
    const cache = createProviderAccountStatusCache({ probe, now: () => clock });
    const one = { claude: [{ id: "work", label: "work", color: "#b" }] };
    expect((await cache.read(one)).get("claude\nwork")).toBe("ready");
    await cache.read(one);
    expect(probe).toHaveBeenCalledTimes(1);
    clock = 6 * 60_000;
    next = "unknown";
    expect((await cache.read(one)).get("claude\nwork")).toBe("ready");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("does not hold the catalog past the first-read window", async () => {
    vi.useFakeTimers();
    try {
      const cache = createProviderAccountStatusCache({
        probe: () => new Promise(() => {}),
        firstReadWaitMs: 50,
      });
      const read = cache.read({
        claude: [{ id: "work", label: "work", color: "#b" }],
      });
      await vi.advanceTimersByTimeAsync(50);
      expect((await read).get("claude\nwork")).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs at most three probes at once", async () => {
    let active = 0;
    let peak = 0;
    const cache = createProviderAccountStatusCache({
      probe: async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return "signedIn" as const;
      },
    });
    const many = {
      claude: Array.from({ length: 7 }, (_, index) => ({
        id: `a${index}`,
        label: "a",
        color: "#a",
      })),
    };
    await cache.read(many);
    expect(peak).toBe(3);
  });
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
describe("provider account status onChange", () => {
  it("fires only when a definitive status changes", async () => {
    let clock = 0;
    let next: "signedIn" | "signedOut" | "unknown" = "signedIn";
    const onChange = vi.fn();
    const one = { claude: [{ id: "work", label: "work", color: "#b" }] };
    const cache = createProviderAccountStatusCache({
      probe: async () => next,
      now: () => clock,
      onChange,
    });
    await cache.read(one);
    expect(onChange).toHaveBeenCalledTimes(1);
    clock += 6 * 60_000;
    await cache.read(one);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    next = "unknown";
    clock += 6 * 60_000;
    await cache.read(one);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    next = "signedOut";
    clock += 6 * 60_000;
    await cache.read(one);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  });
});
