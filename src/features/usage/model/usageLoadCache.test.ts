import { beforeEach, expect, it } from "vitest";
import { clearUsageLoadCache, recallUsageLoad, rememberUsageLoad } from "./usageLoadCache";
import { previousUsageWindow } from "./usageAnalytics";

const interval = { start: 1_000_000_000, end: 2_000_000_000 };
const since = Math.max(0, previousUsageWindow(interval).start);
const empty = { queryKey: "", refreshedAt: 0 };

beforeEach(clearUsageLoadCache);

it("recalls a finished read for the same lower bound", () => {
  const done = { queryKey: `${since}:${interval.end}:0:0:0`, refreshedAt: 5 };
  rememberUsageLoad(done);
  expect(recallUsageLoad(interval, empty)).toBe(done);
});

it("never shows another interval's numbers", () => {
  rememberUsageLoad({ queryKey: `${since + 1}:${interval.end}:0:0:0`, refreshedAt: 5 });
  expect(recallUsageLoad(interval, empty)).toBe(empty);
});

it("ignores a load that never finished", () => {
  rememberUsageLoad({ queryKey: `${since}:${interval.end}:0:0:0`, refreshedAt: 0 });
  expect(recallUsageLoad(interval, empty)).toBe(empty);
});
