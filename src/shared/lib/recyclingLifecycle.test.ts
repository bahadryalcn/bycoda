import { expect, it, vi } from "vitest";
import { createRecyclingLifecycle } from "./recyclingLifecycle";
it("prewarm stale transportu bozmaz, cwd değişince resume silinir ve teardown önce biter", async () => {
  const live = new Map([["s", { cwd: "/old", stale: true }]]);
  const resume = new Map<string, unknown>([["s", "resume"]]);
  const order: string[] = [];
  const start = vi.fn(async () => {
    order.push("start");
    return { cwd: "/new", stale: false };
  });
  const lifecycle = createRecyclingLifecycle({
    epochs: new Map(),
    queue: new Map(),
    live,
    resume,
    teardown: async () => {
      expect(resume.has("s")).toBe(false);
      order.push("teardown");
    },
    start,
    supersededMessage: "retired",
  });
  expect(await lifecycle.ensure({ sessionId: "s", cwd: "/new" }, false)).toBe(live.get("s"));
  expect(start).not.toHaveBeenCalled();
  await lifecycle.ensure({ sessionId: "s", cwd: "/new" }, true);
  expect(order).toEqual(["teardown", "start"]);
});
it("bekleyen epoch değişirse startup yayınlamaz, rejection sonraki sırayı zehirlemez", async () => {
  let release!: () => void;
  const queue = new Map([
    [
      "s",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    ],
  ]);
  const epochs = new Map<string, object>();
  const start = vi.fn(async () => ({ cwd: "/repo", stale: false }));
  const lifecycle = createRecyclingLifecycle({
    epochs,
    queue,
    live: new Map(),
    resume: new Map(),
    teardown: async () => {},
    start,
    supersededMessage: "retired",
  });
  const pending = lifecycle.ensure({ sessionId: "s", cwd: "/repo" }, true);
  epochs.set("s", {});
  release();
  await expect(pending).rejects.toThrow("retired");
  expect(start).not.toHaveBeenCalled();
  await lifecycle.ensure({ sessionId: "s", cwd: "/repo" }, true);
  expect(start).toHaveBeenCalledOnce();
});

it("prepared admission failure leaves A and its resume untouched", async () => {
  const original = { cwd: "/a", stale: false };
  const live = new Map([["s", original]]),
    resume = new Map<string, unknown>([["s", "original-resume"]]);
  const teardown = vi.fn(async () => {}),
    start = vi.fn(async () => ({ cwd: "/b", stale: false }));
  const failure = new Error("Original owner capacity exhausted");
  const lifecycle = createRecyclingLifecycle({
    epochs: new Map(),
    queue: new Map(),
    live,
    resume,
    teardown,
    start,
    prepare: () => {
      throw failure;
    },
    supersededMessage: "cancelled",
  });
  await expect(lifecycle.ensure({ sessionId: "s", cwd: "/b" }, true)).rejects.toBe(failure);
  expect(live.get("s")).toBe(original);
  expect(resume.get("s")).toBe("original-resume");
  expect(teardown).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it("prepared B is retired after cancellation while original A is held and only explicit fresh C starts", async () => {
  const epochs = new Map<string, object>();
  const live = new Map([["s", { cwd: "/a", stale: false }]]);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const fallback = vi.fn(async () => ({ cwd: "/fallback", stale: false }));
  const lifecycle = createRecyclingLifecycle({
    epochs,
    queue: new Map(),
    live,
    resume: new Map(),
    start: fallback,
    supersededMessage: "prepared cancelled",
    teardown: async () => {
      order.push("retire-a");
      enter();
      await held;
      live.delete("s");
    },
    prepare: (input) => {
      order.push(`reserve:${input.cwd}`);
      return {
        start: async () => {
          order.push(`start:${input.cwd}`);
          return { cwd: input.cwd, stale: false };
        },
        retire: async (error) => {
          order.push(`cleanup:${input.cwd}`);
          throw error;
        },
      };
    },
  });
  const b = lifecycle.ensure({ sessionId: "s", cwd: "/b" }, true);
  const outcome = b.catch((error: unknown) => error);
  await entered;
  expect(order).toEqual(["reserve:/b", "retire-a"]);
  epochs.set("s", {});
  release();
  expect(String(await outcome)).toContain("prepared cancelled");
  expect(order).toEqual(["reserve:/b", "retire-a", "cleanup:/b"]);
  await lifecycle.ensure({ sessionId: "s", cwd: "/c" }, true);
  expect(order.slice(-2)).toEqual(["reserve:/c", "start:/c"]);
  expect(fallback).not.toHaveBeenCalled();
});

it("prepared B cleanup is joined when original A teardown rejects", async () => {
  const original = new Error("Original A teardown failed");
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const start = vi.fn(async () => ({ cwd: "/b", stale: false }));
  const lifecycle = createRecyclingLifecycle({
    epochs: new Map(),
    queue: new Map(),
    live: new Map([["s", { cwd: "/a", stale: true }]]),
    resume: new Map(),
    start,
    supersededMessage: "cancelled",
    teardown: async () => {
      throw original;
    },
    prepare: () => ({
      start,
      retire: async (error) => {
        expect(error).toBe(original);
        enter();
        await held;
        throw error;
      },
    }),
  });
  let settled = false;
  const outcome = lifecycle.ensure({ sessionId: "s", cwd: "/b" }, true).catch((error: unknown) => {
    settled = true;
    return error;
  });
  await entered;
  expect(settled).toBe(false);
  expect(start).not.toHaveBeenCalled();
  release();
  expect(await outcome).toBe(original);
});

it("does not revive an old lifecycle when its retired session id is reused", async () => {
  let release!: () => void;
  const epochs = new Map<string, object>();
  const queue = new Map([
    [
      "s",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    ],
  ]);
  const start = vi.fn(async () => ({ cwd: "/repo", stale: false }));
  const lifecycle = createRecyclingLifecycle({
    epochs,
    queue,
    live: new Map(),
    resume: new Map(),
    start,
    teardown: async () => {},
    supersededMessage: "retired",
  });
  const old = lifecycle.ensure({ sessionId: "s", cwd: "/repo" }, true);
  epochs.set("s", {});
  epochs.delete("s");
  epochs.set("s", {});
  release();
  await expect(old).rejects.toThrow("retired");
  await lifecycle.ensure({ sessionId: "s", cwd: "/repo" }, true);
  expect(start).toHaveBeenCalledOnce();
});
