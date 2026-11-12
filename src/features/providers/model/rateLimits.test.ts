import { boundFormat } from "../../../shared/i18n/boundFormat";
import { t } from "../../../shared/i18n/core";
import { describe, expect, it } from "vitest";
import {
  clampUsedPercent,
  exhaustedWindowResetAt,
  formatRateLimitWindowChipLabel,
  formatResetCountdown,
  formatResetCountdownWith,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  idleRateLimits,
  mapUsageWindow,
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  parseOpencodeGoUsage,
  parseResetTimestamp,
  rateLimitWindowTooltip,
  rateLimitWindowTooltipWith,
} from "./rateLimits";

describe("formatWindowLabel", () => {
  it("uses the compact 5h / wk labels", () => {
    expect(formatWindowLabel(300)).toBe("5h");
    expect(formatWindowLabel(10_080)).toBe("wk");
    expect(formatWindowLabel(60)).toBe("1h");
    expect(formatWindowLabel(45)).toBe("45m");
    expect(formatWindowLabel(1_440)).toBe("1d");
  });
});

describe("formatResetDuration", () => {
  it("floors to whole units", () => {
    expect(formatResetDuration(47 * 60_000)).toBe("47m");
    expect(formatResetDuration(3 * 3_600_000 + 54 * 60_000)).toBe("3h 54m");
    expect(formatResetDuration(3 * 3_600_000)).toBe("3h");
    expect(formatResetDuration(6 * 86_400_000 + 7 * 3_600_000)).toBe("6d 7h");
    expect(formatResetDuration(2 * 86_400_000)).toBe("2d");
  });

  it("reports an expired window as now", () => {
    expect(formatResetDuration(0)).toBe("now");
    expect(formatResetDuration(-1_000)).toBe("now");
  });
});

describe("formatResetCountdown", () => {
  it("prefixes remaining time", () => {
    expect(formatResetCountdown(2 * 3_600_000 + 33 * 60_000)).toBe("Resets in 2h 33m");
    expect(formatResetCountdown(0)).toBe("Resets now");
  });
});

describe("formatRateLimitWindowChipLabel", () => {
  const now = Date.parse("2026-08-27T08:00:00Z");

  it("prefers remaining time when resetsAt is known", () => {
    expect(
      formatRateLimitWindowChipLabel(
        {
          usedPercent: 42,
          windowMinutes: 300,
          resetsAt: now + 2 * 3_600_000 + 33 * 60_000,
        },
        now,
      ),
    ).toBe("2h 33m");
  });

  it("falls back to the window size when no reset timestamp exists", () => {
    expect(
      formatRateLimitWindowChipLabel({ usedPercent: 42, windowMinutes: 300, resetsAt: null }, now),
    ).toBe("5h");
    expect(
      formatRateLimitWindowChipLabel(
        { usedPercent: 41, windowMinutes: 10_080, resetsAt: null },
        now,
      ),
    ).toBe("wk");
  });
});

describe("formatUsagePercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatUsagePercent(58.4)).toBe("58%");
    expect(formatUsagePercent(58.6)).toBe("59%");
    expect(clampUsedPercent(140)).toBe(100);
  });
});

describe("exhaustedWindowResetAt", () => {
  it("returns the latest reset among spent windows", () => {
    const limits = {
      ...idleRateLimits("codex"),
      session: { usedPercent: 100, windowMinutes: 300, resetsAt: 2_000 },
      weekly: { usedPercent: 100, windowMinutes: 10_080, resetsAt: 9_000 },
    };
    expect(exhaustedWindowResetAt(limits)).toBe(9_000);
  });

  it("ignores windows with room left", () => {
    const limits = {
      ...idleRateLimits("claude"),
      session: { usedPercent: 100, windowMinutes: 300, resetsAt: 2_000 },
      weekly: { usedPercent: 40, windowMinutes: 10_080, resetsAt: 9_000 },
    };
    expect(exhaustedWindowResetAt(limits)).toBe(2_000);
    expect(exhaustedWindowResetAt(idleRateLimits("claude"))).toBeNull();
  });
});

describe("parseResetTimestamp", () => {
  it("treats small numbers as unix seconds", () => {
    expect(parseResetTimestamp(1_738_425_600)).toBe(1_738_425_600_000);
  });

  it("keeps millisecond epochs", () => {
    expect(parseResetTimestamp(1_738_425_600_000)).toBe(1_738_425_600_000);
  });

  it("parses ISO strings", () => {
    expect(parseResetTimestamp("2026-08-27T12:00:00.000Z")).toBe(
      Date.parse("2026-08-27T12:00:00.000Z"),
    );
  });
});

describe("parseClaudeOAuthUsage", () => {
  it("maps five_hour and seven_day windows", () => {
    const limits = parseClaudeOAuthUsage(
      JSON.stringify({
        five_hour: { used_percentage: 58.2, resets_at: 1_738_425_600 },
        seven_day: { utilization: 41, resets_at: "2026-09-01T00:00:00.000Z" },
      }),
    );
    expect(limits.status).toBe("ok");
    expect(limits.session).toEqual({
      usedPercent: 58.2,
      windowMinutes: 300,
      resetsAt: 1_738_425_600_000,
    });
    expect(limits.weekly?.usedPercent).toBe(41);
    expect(limits.weekly?.windowMinutes).toBe(10_080);
    expect(limits.weekly?.resetsAt).toBe(Date.parse("2026-09-01T00:00:00.000Z"));
  });

  it("maps banked resets from cedar_ember grants", () => {
    const limits = parseClaudeOAuthUsage(
      JSON.stringify({
        five_hour: null,
        seven_day: { utilization: 28, resets_at: "2026-11-18T02:59:59Z" },
        cedar_ember: {
          grants: [
            {
              id: "full-reset-2611",
              label: "One full limit reset (November 2026)",
              resets_left: 1,
              ends_at: "2026-12-10T22:00:00+00:00",
              usable_now: true,
            },
            {
              id: "two-left",
              label: "Fable reset",
              resets_left: 2,
              usable_now: false,
              type: "weekly",
              gives_back_weekly: true,
            },
            { id: "by-clears", label: "Session", resets_left: 1, clears: ["five_hour"] },
            { id: "spent", label: "Spent", resets_left: 0 },
          ],
        },
      }),
    );
    expect(limits.session).toBeNull();
    expect(limits.resetCredits?.availableCount).toBe(4);
    // The kind names the row: Fable give-back wins over the declared type.
    expect(limits.resetCredits?.credits?.map((credit) => credit.kind)).toEqual([
      "full",
      "fable",
      "fable",
      "session",
    ]);
    expect(limits.resetCredits?.credits?.[0]).toMatchObject({
      id: "full-reset-2611:0",
      status: "available",
      title: "One full limit reset (November 2026)",
      expiresAt: Date.parse("2026-12-10T22:00:00+00:00"),
    });
    expect(limits.resetCredits?.credits?.[2]).toMatchObject({
      id: "two-left:1",
      status: "unknown",
    });
  });

  it("has no banked resets when cedar_ember lists none", () => {
    const limits = parseClaudeOAuthUsage(
      JSON.stringify({ seven_day: { utilization: 1 }, cedar_ember: { grants: [] } }),
    );
    expect(limits.resetCredits).toBeNull();
  });

  it("returns an error for garbage", () => {
    const limits = parseClaudeOAuthUsage("not json");
    expect(limits.status).toBe("error");
    expect(limits.session).toBeNull();
  });
});

describe("mapUsageWindow", () => {
  it("accepts camelCase Codex-shaped windows", () => {
    expect(mapUsageWindow({ usedPercent: 12, resetsAt: 1_738_425_600 }, 300)).toEqual({
      usedPercent: 12,
      windowMinutes: 300,
      resetsAt: 1_738_425_600_000,
    });
  });
});

describe("parseCodexRateLimits", () => {
  it("classifies primary/secondary by duration", () => {
    const limits = parseCodexRateLimits({
      rateLimits: {
        primary: {
          usedPercent: 52,
          windowDurationMins: 300,
          resetsAt: 1_738_425_600,
        },
        secondary: {
          used_percent: 37,
          window_duration_mins: 10_080,
          resets_at: 1_738_900_000,
        },
      },
    });
    expect(limits.session?.usedPercent).toBe(52);
    expect(limits.session?.windowMinutes).toBe(300);
    expect(limits.weekly?.usedPercent).toBe(37);
    expect(limits.weekly?.windowMinutes).toBe(10_080);
  });

  it("maps banked reset credits and their expiry", () => {
    const limits = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 52, windowDurationMins: 300 },
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [
          {
            id: "reset-1",
            resetType: "codexRateLimits",
            status: "available",
            grantedAt: 1_788_768_000,
            expiresAt: 1_791_360_000,
            title: "Referral reward",
            description: "One Codex rate-limit reset",
          },
        ],
      },
    });

    expect(limits.resetCredits).toEqual({
      availableCount: 2,
      credits: [
        {
          id: "reset-1",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: 1_788_768_000_000,
          expiresAt: 1_791_360_000_000,
          title: "Referral reward",
          description: "One Codex rate-limit reset",
        },
      ],
    });
  });

  it("keeps an aggregate banked reset count without detail rows", () => {
    const limits = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 12, windowDurationMins: 300 },
      },
      rate_limit_reset_credits: {
        available_count: "3",
        credits: null,
      },
    });

    expect(limits.resetCredits).toEqual({ availableCount: 3, credits: null });
  });

  it("maps a free plan's lone 30-day primary window to monthly", () => {
    const limits = parseCodexRateLimits({
      rateLimits: {
        primary: {
          usedPercent: 4,
          windowDurationMins: 43_200,
          resetsAt: 1_792_550_273,
        },
        secondary: null,
      },
    });
    expect(limits.session).toBeNull();
    expect(limits.weekly).toBeNull();
    expect(limits.monthly).toEqual({
      usedPercent: 4,
      windowMinutes: 43_200,
      resetsAt: 1_792_550_273_000,
    });
  });

  it("falls back to primary=session when durations are unknown", () => {
    const limits = parseCodexRateLimits({
      primary: { usedPercent: 10, resetsAt: 100 },
      secondary: { usedPercent: 20, resetsAt: 200 },
    });
    expect(limits.session?.usedPercent).toBe(10);
    expect(limits.weekly?.usedPercent).toBe(20);
  });
});

describe("parseOpencodeGoUsage", () => {
  it("maps rolling/weekly/monthly windows with reset times", () => {
    const limits = parseOpencodeGoUsage({
      usage: {
        rolling: {
          status: "ok",
          percent: 42,
          resetsAt: "2026-09-16T16:27:38.287Z",
        },
        weekly: { status: "ok", percent: 30, resetsAt: "2026-09-23T00:00:00Z" },
        monthly: {
          status: "ok",
          percent: 12,
          resetsAt: "2026-10-16T00:00:00Z",
        },
      },
    });
    expect(limits.provider).toBe("opencode");
    expect(limits.session?.usedPercent).toBe(42);
    expect(limits.session?.windowMinutes).toBe(300);
    expect(limits.weekly?.usedPercent).toBe(30);
    expect(limits.weekly?.windowMinutes).toBe(10_080);
    expect(limits.monthly?.usedPercent).toBe(12);
    expect(limits.monthly?.windowMinutes).toBe(43_200);
    expect(limits.session?.resetsAt).toBe(Date.parse("2026-09-16T16:27:38.287Z"));
  });

  it("drops non-ok windows instead of claiming usage", () => {
    const limits = parseOpencodeGoUsage({
      usage: {
        rolling: { status: "ok", percent: 5, resetsAt: null },
        weekly: { status: "expired", percent: 50, resetsAt: null },
        monthly: { percent: 50, resetsAt: null },
      },
    });
    expect(limits.session?.usedPercent).toBe(5);
    expect(limits.weekly).toBeNull();
    expect(limits.monthly).toBeNull();
  });
});

describe("rateLimitWindowTooltip", () => {
  it("includes used percent and remaining time", () => {
    const now = Date.parse("2026-08-27T08:00:00Z");
    expect(
      rateLimitWindowTooltip(
        {
          usedPercent: 42.4,
          windowMinutes: 300,
          resetsAt: now + 2 * 3_600_000 + 33 * 60_000,
        },
        now,
      ),
    ).toBe("42% used · Resets in 2h 33m");
  });

  it("shows remaining percent with a reset countdown", () => {
    const now = Date.parse("2026-08-27T08:00:00Z");
    expect(
      rateLimitWindowTooltip(
        {
          usedPercent: 42.4,
          windowMinutes: 300,
          resetsAt: now + 2 * 3_600_000,
        },
        now,
        true,
      ),
    ).toBe("58% remaining · Resets in 2h");
  });

  it.each([
    [0, "100%"],
    [100, "0%"],
    [-10, "100%"],
    [110, "0%"],
  ])("clamps %s used before showing remaining usage", (usedPercent, remaining) => {
    expect(
      rateLimitWindowTooltip({ usedPercent, windowMinutes: 10_080, resetsAt: null }, 0, true),
    ).toBe(`${remaining} remaining · wk window`);
  });
});

describe("explicit-translator variants", () => {
  const shout = ((key: string, params?: Record<string, unknown>) =>
    `X:${key.replace("{p0}", String(params?.p0 ?? ""))}`) as typeof t;
  it("match the originals with the module translator", () => {
    const window = { usedPercent: 40, windowMinutes: 300, resetsAt: 1_000_000 + 9_000_000 };
    for (const showRemaining of [false, true]) {
      expect(rateLimitWindowTooltipWith(window, 1_000_000, showRemaining, t, boundFormat())).toBe(
        rateLimitWindowTooltip(window, 1_000_000, showRemaining),
      );
    }
    const open = { usedPercent: 10, windowMinutes: 300, resetsAt: null };
    expect(rateLimitWindowTooltipWith(open, 0, false, t, boundFormat())).toBe(
      rateLimitWindowTooltip(open, 0),
    );
    expect(formatResetCountdownWith(5_400_000, t, boundFormat())).toBe(
      formatResetCountdown(5_400_000),
    );
    expect(formatResetCountdownWith(0, t, boundFormat())).toBe(formatResetCountdown(0));
  });
  it("use the translator passed in", () => {
    expect(formatResetCountdownWith(0, shout, boundFormat())).toBe("X:Resets now");
    expect(formatResetCountdownWith(3_600_000, shout, boundFormat())).toContain("X:Resets in");
  });
});
