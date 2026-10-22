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
  const epochs = new Map<string, number>();
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
  epochs.set("s", 1);
  release();
  await expect(pending).rejects.toThrow("retired");
  expect(start).not.toHaveBeenCalled();
  await lifecycle.ensure({ sessionId: "s", cwd: "/repo" }, true);
  expect(start).toHaveBeenCalledOnce();
});
