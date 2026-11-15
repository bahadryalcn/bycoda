import { expect, it } from "vitest";
import { applyHarnessEvent } from "../../src/integrations/harness/core/apply";
import type { HarnessEvent } from "../../src/integrations/harness/core/types";
import type { Session } from "../../src/features/sessions/model/session";
import { applyDeltaBurst, plainDeltaRun, type DeltaItem } from "./event-batch";

const session = {
  id: "s",
  cwd: "/tmp",
  harness: "codex",
  model: "codex:test",
  modelSettings: {},
  runtimeMode: "supervised",
  title: "t",
  busy: true,
  blocks: [{ id: "u", role: "user", text: "hi" }],
} as unknown as Session;

const delta = (text: string, type: "message.delta" | "reasoning.delta" = "message.delta") =>
  ({ runId: "r", observedAt: 1, event: { type, text } }) as DeltaItem;

it("matches sequential apply for a burst of deltas", () => {
  const items = [
    delta("a"),
    delta("b"),
    delta("r1", "reasoning.delta"),
    delta("c"),
    delta(""),
    delta("d"),
  ];
  const sequential = items.reduce(
    (value, item) => applyHarnessEvent(value, item.event as HarnessEvent),
    session,
  );
  const burst = applyDeltaBurst(session, items);
  expect(burst.session.blocks.map(({ role, text }) => ({ role, text }))).toEqual(
    sequential.blocks.map(({ role, text }) => ({ role, text })),
  );
  expect(burst.events).toHaveLength(items.length);
});

it("copies the transcript once per burst", () => {
  const slice = Array.prototype.slice;
  let copies = 0;
  const blocks = session.blocks.slice();
  blocks.slice = function (this: unknown[], ...args: [number?, number?]) {
    copies++;
    return slice.apply(this, args);
  } as typeof blocks.slice;
  const items = Array.from({ length: 50 }, (_, index) => delta(`t${index}`));
  const burst = applyDeltaBurst({ ...session, blocks }, items);
  expect(copies).toBeLessThanOrEqual(2);
  expect(burst.session.blocks.at(-1)?.text).toBe(items.map((i) => i.event.text).join(""));
});

it("keeps run boundaries and non-delta events out of a delta run", () => {
  const other = { ...delta("x"), runId: "other" };
  const tool = {
    runId: "r",
    observedAt: 1,
    event: { type: "message.completed" },
  } as never;
  expect(plainDeltaRun([delta("a"), delta("b"), other], 0)).toBe(2);
  expect(plainDeltaRun([delta("a"), tool, delta("b")], 0)).toBe(1);
});
