import { expect, it } from "vitest";
import { workerContextAction, validWorkerContextSettings } from "./assistantContext";

it.each([
  [undefined, undefined, "compact"],
  [0, 1000, "send"],
  [499, 1000, "send"],
  [500, 1000, "compact"],
  [799, 1000, "compact"],
  [800, 1000, "handoff"],
  [149999, 1000000, "send"],
  [150000, 1000000, "compact"],
  [300000, 1000000, "handoff"],
  [10, undefined, "compact"],
  [-1, 1000, "compact"],
  [NaN, 1000, "compact"],
  [100, 0, "compact"],
  [100, Infinity, "compact"],
] as const)("admits worker context %s / %s as %s", (used, window, expected) => {
  expect(workerContextAction(used, window)).toBe(expected);
});

it("applies the owner's absolute and relative worker limits at the actual boundaries", () => {
  const settings = {
    workerSoftContext: 60000,
    workerHardContext: 120000,
    workerCompactPercent: 40,
    workerHandoffPercent: 70,
  };
  expect(validWorkerContextSettings(settings)).toBe(true);
  expect(workerContextAction(59999, 1000000, settings)).toBe("send");
  expect(workerContextAction(60000, 1000000, settings)).toBe("compact");
  expect(workerContextAction(120000, 1000000, settings)).toBe("handoff");
  expect(workerContextAction(39999, 100000, settings)).toBe("send");
  expect(workerContextAction(40000, 100000, settings)).toBe("compact");
  expect(workerContextAction(70000, 100000, settings)).toBe("handoff");
  expect(workerContextAction(undefined, undefined, settings)).toBe("compact");
});

it.each([
  { workerSoftContext: 300000, workerHardContext: 150000 },
  { workerCompactPercent: 80, workerHandoffPercent: 50 },
  { workerSoftContext: 0 },
  { workerHardContext: Infinity },
  { workerHandoffPercent: 100 },
  { workerCompactPercent: NaN },
])("invalid saved context policy cannot authorize a send: %j", (settings) => {
  expect(validWorkerContextSettings(settings)).toBe(false);
  expect(workerContextAction(1000, 1000000, settings)).toBe("compact");
});
