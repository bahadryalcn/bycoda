import { expect, it, vi } from "vitest";
import { compactionContextEvents } from "./compactionContext";
import { applyHarnessEvent } from "./apply";
import { newSession } from "../../../features/sessions/model/session";

it("holds pre-compact readings and clears old usage only after success", () => {
  const emit = vi.fn();
  const events = compactionContextEvents(emit);
  events.onEvent({ type: "context", used: 900, window: 1000 });
  expect(emit).not.toHaveBeenCalled();
  events.complete();
  const session = { ...newSession("codex", "/repo"), context: { used: 900, window: 1000 } };
  const cleared = applyHarnessEvent(session, emit.mock.calls[0]![0]);
  expect(cleared.context).toBeUndefined();
  expect(applyHarnessEvent(cleared, { type: "context", window: 1000 }).context).toBeUndefined();
  expect(
    applyHarnessEvent(session, { type: "context.compacted", used: Number.NaN }).context,
  ).toBeUndefined();
  expect(applyHarnessEvent(cleared, { type: "context", used: 200, window: 1000 }).context).toEqual({
    used: 200,
    window: 1000,
  });
});

it("retains a provider's explicit post-compact reading until success", () => {
  const emit = vi.fn();
  const events = compactionContextEvents(emit);
  events.onEvent({ type: "context.compacted", used: 123, window: 1000 });
  expect(emit).not.toHaveBeenCalled();
  events.complete();
  expect(emit).toHaveBeenCalledWith({ type: "context.compacted", used: 123, window: 1000 });
  const session = { ...newSession("pi", "/repo"), context: { used: 900, window: 1000 } };
  expect(applyHarnessEvent(session, emit.mock.calls[0]![0]).context).toEqual({
    used: 123,
    window: 1000,
  });
});
