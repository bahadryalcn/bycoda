import { expect, it, vi } from "vitest";
import { TurnLatch } from "./turnLatch";
import type { HarnessEvent } from "../../integrations/harness/core/types";

it("emits extra events before the callback and drains the latch before the callback", () => {
  const order: string[] = [];
  const state = {
    turnDone: null as (() => void) | null,
    turnFailed: null as unknown,
    turnEndPending: false,
    onEvent: () => order.push("event"),
  };
  state.turnDone = () => {
    expect(state.turnDone).toBeNull();
    order.push("done");
  };
  TurnLatch.finish(state, [{ type: "turn.completed" } as HarnessEvent]);
  expect(order).toEqual(["event", "done"]);
  expect(state.turnEndPending).toBe(false);
});
it("keeps an early finish pending and settles once when the callback attaches", () => {
  const state = {
    turnDone: null as (() => void) | null,
    turnFailed: null as unknown,
    turnEndPending: false,
    onEvent: vi.fn(),
  };
  TurnLatch.finish(state);
  expect(state.turnEndPending).toBe(true);
  const done = vi.fn();
  state.turnDone = done;
  TurnLatch.settle(state, () => {
    state.turnEndPending = false;
    TurnLatch.finish(state);
  });
  TurnLatch.settle(state, () => TurnLatch.finish(state));
  expect(done).toHaveBeenCalledTimes(1);
});
it("does not make a failed turn pending again like an early successful finish", () => {
  const state = {
    turnDone: null,
    turnFailed: vi.fn(),
    turnEndPending: false,
    onEvent: vi.fn(),
  };
  TurnLatch.finish(state);
  expect(state.turnEndPending).toBe(false);
  expect(state.turnFailed).toBeNull();
});
