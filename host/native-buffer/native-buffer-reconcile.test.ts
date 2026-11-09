import { expect, it, vi } from "vitest";
import { assertProcessDead, createReconcileOutcome } from "./native-buffer-reconcile";

const blocked = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ instanceId: `i${i}`, processId: i + 1 }));

it("acknowledges when nothing is blocked", () => {
  const warn = vi.fn();
  expect(createReconcileOutcome(warn)("c", [])).toEqual({ acknowledged: true });
  expect(warn).not.toHaveBeenCalled();
});

it("answers recovery-required, bounds the list and warns once per blocking set", () => {
  const warn = vi.fn();
  const outcome = createReconcileOutcome(warn);
  const first = outcome("c", blocked(150));
  expect(first).toMatchObject({ state: "recovery-required", total: 150 });
  expect("blocked" in first && first.blocked).toHaveLength(100);
  expect(outcome("c", blocked(150))).toEqual(first);
  expect(warn).toHaveBeenCalledTimes(1);
  outcome("c", blocked(2));
  expect(warn).toHaveBeenCalledTimes(2);
  outcome("c", []);
  outcome("c", blocked(2));
  expect(warn).toHaveBeenCalledTimes(3);
});

it("proves death only for a missing process", () => {
  expect(() => assertProcessDead(process.pid)).toThrow("not proven dead");
  expect(() => assertProcessDead(2 ** 22 + 12345)).not.toThrow();
});
