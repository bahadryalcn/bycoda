import { describe, expect, it, vi } from "vitest";
import type { TodayData } from "./todayAggregate";
import {
  buildSummaryPrompt,
  dailyNoteTitle,
  estimateSummaryCost,
  generateSummary,
  saveDailyNote,
  type DailyNoteApi,
} from "./todaySummary";

const data: TodayData = {
  period: "today",
  window: {
    start: new Date(2026, 10, 4).getTime(),
    end: new Date(2026, 10, 4, 15).getTime(),
  },
  totals: { cost: 4.2, runMs: 3_600_000, sessions: 2, unpricedTokens: 0 },
  projects: [
    {
      key: "c:/work/alpha",
      label: "alpha",
      path: "C:/work/alpha",
      cost: 4.2,
      runMs: 3_600_000,
      sessions: 2,
      unpricedTokens: 0,
      titles: ["Fix login redirect", "Refactor billing"],
    },
  ],
  days: [],
};
const options = { includeTitles: false, activeMinutes: 95, language: "en" };

describe("summary request", () => {
  it("is metadata only by default: no titles, no paths", () => {
    const prompt = buildSummaryPrompt(data, options);
    expect(prompt).toContain('"name": "alpha"');
    expect(prompt).toContain('"sessions": 2');
    expect(prompt).toContain('"agentRunMinutes": 60');
    expect(prompt).toContain('"apiEquivalentCostUsd": 4.2');
    expect(prompt).not.toContain("Fix login redirect");
    expect(prompt).not.toContain("C:/work");
    expect(prompt).not.toContain("sessionTitles");
  });

  it("adds capped titles only when asked", () => {
    const long = {
      ...data.projects[0]!,
      titles: Array.from({ length: 30 }, (_, i) => `t${i} ${"x".repeat(200)}`),
    };
    const prompt = buildSummaryPrompt(
      { ...data, projects: [long] },
      { ...options, includeTitles: true },
    );
    expect(prompt).toContain("sessionTitles");
    expect(prompt).toContain("t9 ");
    expect(prompt).not.toContain("t10 ");
    expect(prompt).not.toContain("x".repeat(100));
  });

  it("estimates the cost of the exact prompt before sending", () => {
    const prompt = buildSummaryPrompt(data, options);
    const priced = estimateSummaryCost(prompt, {
      input: 3,
      output: 15,
      cacheRead: 0.3,
    });
    expect(priced.inputTokens).toBe(Math.ceil(prompt.length / 4));
    expect(priced.cost).toBeCloseTo((priced.inputTokens * 3 + priced.outputTokens * 15) / 1e6, 12);
    expect(estimateSummaryCost(prompt, null).cost).toBeNull();
  });

  it("calls the provider only from generateSummary", async () => {
    const run = vi.fn(async () => "  Worked on alpha.  ");
    const prompt = buildSummaryPrompt(data, options);
    estimateSummaryCost(prompt, null);
    buildSummaryPrompt(data, { ...options, includeTitles: true });
    expect(run).not.toHaveBeenCalled();
    await expect(generateSummary(prompt, run, new AbortController().signal)).resolves.toBe(
      "Worked on alpha.",
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(prompt);
  });

  it("rejects an empty answer", async () => {
    await expect(
      generateSummary("p", async () => " ", new AbortController().signal),
    ).rejects.toThrow();
  });
});

describe("daily note", () => {
  const day = new Date(2026, 10, 4, 18);
  const api = (
    existing: boolean,
  ): DailyNoteApi & {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  } => ({
    find: async () => (existing ? { id: "n1" } : null),
    read: async () => ({
      id: "n1",
      title: dailyNoteTitle(day),
      body: "first",
      tags: ["daily-summary"],
      updatedAt: 7,
    }),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
  });

  it("creates the day's note once", async () => {
    const notes = api(false);
    await saveDailyNote(notes, "text", day);
    expect(notes.create).toHaveBeenCalledWith({
      title: "Daily summary 2026-11-04",
      body: "text",
      tags: ["daily-summary"],
    });
    expect(notes.update).not.toHaveBeenCalled();
  });

  it("appends to an existing note with its version", async () => {
    const notes = api(true);
    await saveDailyNote(notes, "second", day);
    expect(notes.update).toHaveBeenCalledWith({
      id: "n1",
      expectedUpdatedAt: 7,
      title: "Daily summary 2026-11-04",
      body: "first\n\n---\n\nsecond",
      tags: ["daily-summary"],
    });
    expect(notes.create).not.toHaveBeenCalled();
  });
});
