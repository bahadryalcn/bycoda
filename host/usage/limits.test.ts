import { beforeEach, expect, it } from "vitest";
import { windowReading } from "./limits-pace";
import { parseClaudeUsage, parseCodexLimits, resetTimestamp } from "./limits-parse";
import { clearLimitsCache, readUsageLimits } from "./limits-report";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const week = 10_080;
const at = (ms: number) => NOW + ms;
const DAY = 86_400_000;

it("marks a window ahead, on or behind pace against the clock", () => {
  // 4.5 of 7 days remain (64% of the time) while 37% is left: spending too fast.
  const ahead = windowReading({ usedPercent: 63, windowMinutes: week, resetsAt: at(4.5 * DAY) }, NOW);
  expect(ahead).toMatchObject({ leftPercent: 37, regainPercent: 63, pace: "ahead", timeLeftPercent: 64.3 });
  expect(windowReading({ usedPercent: 36, windowMinutes: week, resetsAt: at(4.5 * DAY) }, NOW).pace).toBe("on");
  expect(windowReading({ usedPercent: 10, windowMinutes: week, resetsAt: at(4.5 * DAY) }, NOW).pace).toBe("behind");
  // The tolerance edge counts as on pace.
  expect(windowReading({ usedPercent: 40.7, windowMinutes: week, resetsAt: at(4.5 * DAY) }, NOW).pace).toBe("on");
});

it("gives no pace without a live reset time and clamps percentages", () => {
  expect(windowReading({ usedPercent: 50, windowMinutes: week, resetsAt: null }, NOW).pace).toBeNull();
  expect(windowReading({ usedPercent: 50, windowMinutes: week, resetsAt: NOW - 1 }, NOW).pace).toBeNull();
  expect(windowReading({ usedPercent: 140, windowMinutes: 300, resetsAt: at(1000) }, NOW)).toMatchObject({
    usedPercent: 100,
    leftPercent: 0,
  });
});

it("parses Claude windows including model-specific weekly limits", () => {
  const { windows } = parseClaudeUsage({
    five_hour: { utilization: 12, resets_at: "2026-11-09T15:00:00Z" },
    seven_day: { utilization: 63, resets_at: "2026-11-14T00:00:00Z" },
    seven_day_fable: { utilization: 37, resets_at: "2026-11-14T00:00:00Z" },
    seven_day_oauth_apps: { utilization: 1, resets_at: null },
    seven_day_sonnet: null,
  });
  expect(windows.map((w) => [w.key, w.model])).toEqual([
    ["session", null],
    ["weekly", null],
    ["weekly:fable", "Fable"],
  ]);
  expect(windows[0].window.resetsAt).toBe(Date.parse("2026-11-09T15:00:00Z"));
});

it("classifies Codex windows by duration and reads reset credits", () => {
  const parsed = parseCodexLimits({
    rateLimits: {
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1_794_000_000 },
      secondary: null,
    },
    rateLimitResetCredits: { availableCount: 2 },
  });
  expect(parsed.windows).toHaveLength(1);
  expect(parsed.windows[0]).toMatchObject({ key: "weekly", kind: "weekly" });
  expect(parsed.windows[0].window.resetsAt).toBe(1_794_000_000_000);
  expect(parsed.resetCredits).toBe(2);
  // Unknown durations fall back to primary = session.
  expect(parseCodexLimits({ primary: { usedPercent: 5 } }).windows[0].key).toBe("session");
});

it("normalises reset timestamps", () => {
  expect(resetTimestamp(1_794_000_000)).toBe(1_794_000_000_000);
  expect(resetTimestamp("0")).toBeNull();
  expect(resetTimestamp("nope")).toBeNull();
});

beforeEach(clearLimitsCache);

it("groups accounts into one card per window, best headroom first, and survives a failing account", async () => {
  const report = await readUsageLimits({
    environmentId: "env",
    now: () => NOW,
    accounts: async () => ({
      claude: [
        { id: "default", label: "Host default", color: "#111" },
        { id: "a2", label: "Claude account 1", color: "#222" },
        { id: "a3", label: "Claude account 2", color: "#333" },
      ],
      codex: [],
    }),
    fetchAccount: async (_provider, id) => {
      if (id === "a3") throw new Error("boom");
      const used = id === "default" ? 90 : 40;
      return {
        status: "ok",
        limits: {
          resetCredits: null,
          windows: [
            { key: "weekly", kind: "weekly", model: null, window: { usedPercent: used, windowMinutes: week, resetsAt: at(4.5 * DAY) } },
            ...(id === "a2"
              ? [{ key: "weekly:fable", kind: "weekly" as const, model: "Fable", window: { usedPercent: 37, windowMinutes: week, resetsAt: at(4.5 * DAY) } }]
              : []),
          ],
        },
      };
    },
  });
  const claude = report.providers.find((p) => p.provider === "claude")!;
  expect(claude.cards.map((c) => c.key)).toEqual(["weekly", "weekly:fable"]);
  expect(claude.cards[0].best.leftPercent).toBe(60);
  expect(claude.cards[0].accounts.map((a) => a.id)).toEqual(["a2", "default"]);
  expect(claude.accounts.find((a) => a.id === "a3")).toMatchObject({ status: "error" });
  expect(report.providers.find((p) => p.provider === "codex")!.cards).toEqual([]);
});
