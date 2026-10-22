import { expect, it, vi } from "vitest";
import { finalizeLocalTurn } from "./localTurnFinalization";

it("settles the retired turn's recording without committing a replacement's UI", async () => {
  const order: string[] = [];
  const committed = await finalizeLocalTurn({ isCurrent: () => false,
    retire: async () => { order.push("retire"); }, settle: async () => { order.push("snapshot"); },
    checkpoint: async () => { order.push("flush"); }, commit: () => { order.push("commit"); } });
  expect(committed).toBe(false); expect(order).toEqual(["retire", "snapshot"]);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("leaves a replacement turn untouched after deferred failed-provider retirement", async () => {
  const retirement = deferred();
  let generation = 1;
  const checkpoint = vi.fn(async () => {});
  const commit = vi.fn();
  const finished = finalizeLocalTurn({
    isCurrent: () => generation === 1,
    retire: () => retirement.promise,
    checkpoint,
    commit,
  });
  generation = 2;
  retirement.resolve();
  expect(await finished).toBe(false);
  expect(checkpoint).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("leaves a replacement turn untouched after a deferred checkpoint", async () => {
  const checkpoint = deferred();
  let generation = 1;
  const commit = vi.fn();
  const finished = finalizeLocalTurn({
    isCurrent: () => generation === 1,
    retire: async () => {},
    checkpoint: () => checkpoint.promise,
    commit,
  });
  await Promise.resolve();
  generation = 2;
  checkpoint.resolve();
  expect(await finished).toBe(false);
  expect(commit).not.toHaveBeenCalled();
});

it("commits the current turn after its retirement and checkpoint finish", async () => {
  const order: string[] = [];
  expect(
    await finalizeLocalTurn({
      isCurrent: () => true,
      retire: async () => {
        order.push("retire");
      },
      checkpoint: async () => {
        order.push("checkpoint");
      },
      commit: () => {
        order.push("commit");
      },
    }),
  ).toBe(true);
  expect(order).toEqual(["retire", "checkpoint", "commit"]);
});

it("retires a failed transport after Stop without touching terminal state", async () => {
  const retire = vi.fn(async () => {});
  const checkpoint = vi.fn(async () => {});
  const commit = vi.fn();
  expect(await finalizeLocalTurn({ isCurrent: () => false, retire, checkpoint, commit })).toBe(
    false,
  );
  expect(retire).toHaveBeenCalledOnce();
  expect(checkpoint).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
