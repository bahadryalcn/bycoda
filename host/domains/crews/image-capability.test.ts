import { expect, it, vi } from "vitest";
import { createCrewImageCapabilityProbe } from "./image-capability";

const candidate = { harness: "codex" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

it("rejects a revoked waiter without sharing another caller's grant", async () => {
  const completed = deferred<{ available: boolean }>();
  const probe = vi.fn(() => completed.promise);
  const check = createCrewImageCapabilityProbe({ probe });
  let firstAllowed = true;
  const firstGuard = vi.fn(async () => {
    if (!firstAllowed) throw new Error("revoked");
  });
  const secondGuard = vi.fn(async () => {});
  const first = check(candidate, "image-generation", firstGuard).catch((error) => error);
  const second = check(candidate, "image-generation", secondGuard);
  await Promise.resolve();
  firstAllowed = false;
  completed.resolve({ available: true });
  expect((await first).message).toBe("revoked");
  expect(await second).toBe(true);
  expect(probe).toHaveBeenCalledOnce();
  expect(await check(candidate, "image-generation", secondGuard)).toBe(true);
  expect(probe).toHaveBeenCalledOnce();
});

it("evicts rejected probe work and retries with the next authorized request", async () => {
  const revoked = Object.assign(new Error("revoked during native preparation"), {
    code: "HOST_AUTH_REVOKED",
  });
  const probe = vi.fn().mockRejectedValueOnce(revoked).mockResolvedValueOnce({ available: true });
  const check = createCrewImageCapabilityProbe({ probe });
  const guard = async () => {};
  await expect(check(candidate, "image-generation", guard)).rejects.toBe(revoked);
  expect(await check(candidate, "image-generation", guard)).toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
});

it("does not reject an authorized waiter when the preceding probe loses its own grant", async () => {
  const prepared = deferred<void>();
  const entered = deferred<void>();
  let firstAllowed = true;
  const firstGuard = async () => {
    if (!firstAllowed) throw new Error("first caller revoked");
  };
  const secondGuard = vi.fn(async () => {});
  let active = 0,
    peak = 0;
  const probe = vi.fn(async (authorize?: () => Promise<void>) => {
    active++;
    peak = Math.max(peak, active);
    try {
      if (probe.mock.calls.length === 1) {
        entered.resolve();
        await prepared.promise;
      }
      await authorize?.();
      return { available: true };
    } finally {
      active--;
    }
  });
  const check = createCrewImageCapabilityProbe({ probe });
  const first = check(candidate, "image-generation", firstGuard).catch((error) => error);
  await entered.promise;
  const second = check(candidate, "image-generation", secondGuard);
  firstAllowed = false;
  prepared.resolve();
  expect((await first).message).toBe("first caller revoked");
  expect(await second).toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(peak).toBe(1);
  expect(probe.mock.calls[1][0]).toBe(secondGuard);
  expect(await check(candidate, "image-generation", secondGuard)).toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
});

it("checks current authority before cached evidence and expires ordinary unavailable evidence", async () => {
  let now = 0;
  const probe = vi.fn(async () => ({ available: false }));
  const check = createCrewImageCapabilityProbe({ probe, now: () => now });
  expect(await check(candidate, "image-generation")).toBe(false);
  await expect(
    check(candidate, "image-generation", async () => {
      throw new Error("revoked");
    }),
  ).rejects.toThrow("revoked");
  expect(probe).toHaveBeenCalledOnce();
  now = 60_001;
  expect(await check(candidate, "image-generation")).toBe(false);
  expect(probe).toHaveBeenCalledTimes(2);
  // images.generate is a Host tool, so every member harness shares the Host evidence.
  expect(await check({ harness: "claude" }, "image-generation")).toBe(false);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(await check(candidate, "other-capability")).toBeUndefined();
});

it("counts a member's native image tool when the Host providers are unavailable", async () => {
  const check = createCrewImageCapabilityProbe({
    probe: async () => ({ available: false }),
    native: async (harness) => harness === "antigravity",
  });
  expect(await check({ harness: "antigravity" }, "image-generation", async () => {})).toBe(true);
  expect(await check({ harness: "claude" }, "image-generation", async () => {})).toBe(false);
});
