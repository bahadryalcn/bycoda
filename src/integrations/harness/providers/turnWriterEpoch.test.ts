import { expect, it } from "vitest";
import { retireProviderEpoch } from "../core/providerEpoch";

it("retains cancellation identity until old work settles and never removes replacement state", async () => {
  let finish!: () => void;
  const old = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = {};
  const epochs = new Map([["session", first]]);
  const tails = new Map<string, Promise<unknown>>([["session", old]]);
  retireProviderEpoch(epochs, tails, "session");
  expect(epochs.get("session")).toBe(first);
  const replacement = {};
  const newer = new Promise<void>(() => {});
  epochs.set("session", replacement);
  tails.set("session", newer);
  finish();
  await old;
  await Promise.resolve();
  expect(epochs.get("session")).toBe(replacement);
  tails.delete("session");
  retireProviderEpoch(epochs, tails, "session");
  expect(epochs.has("session")).toBe(false);
});

it("does not retire a marker still captured by a later queued operation", async () => {
  let finish!: () => void;
  const old = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const epoch = {};
  const epochs = new Map([["session", epoch]]);
  const tails = new Map<string, Promise<unknown>>([["session", old]]);
  retireProviderEpoch(epochs, tails, "session");
  tails.set("session", new Promise<void>(() => {}));
  finish();
  await old;
  await Promise.resolve();
  await Promise.resolve();
  expect(epochs.get("session")).toBe(epoch);
});

it("waits for every captured lifecycle queue before retiring a marker", async () => {
  let finishTurn!: () => void;
  let finishLifecycle!: () => void;
  const turn = new Promise<void>((resolve) => {
    finishTurn = resolve;
  });
  const lifecycle = new Promise<void>((resolve) => {
    finishLifecycle = resolve;
  });
  const epochs = new Map([["session", {}]]);
  const turns = new Map<string, Promise<unknown>>([["session", turn]]);
  const lifecycles = new Map<string, Promise<unknown>>([["session", lifecycle]]);
  retireProviderEpoch(epochs, turns, "session", lifecycles);
  finishTurn();
  await turn;
  await Promise.resolve();
  expect(epochs.has("session")).toBe(true);
  finishLifecycle();
  await lifecycle;
  await Promise.resolve();
  await Promise.resolve();
  expect(epochs.has("session")).toBe(false);
});
