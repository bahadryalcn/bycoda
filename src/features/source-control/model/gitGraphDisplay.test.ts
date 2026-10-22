import { describe, expect, it } from "vitest";
import {
  authorColor,
  authorInitials,
  formatAbsoluteTime,
  formatRelativeTime,
  isMergeCommit,
  orderGraphRefs,
  splitRefsForBudget,
} from "./gitGraphDisplay";

describe("authorInitials", () => {
  it("uses first and last word", () => {
    expect(authorInitials("Ada Lovelace")).toBe("AL");
    expect(authorInitials("Jean Claude Van Damme")).toBe("JD");
  });

  it("handles a single word, lowercase included", () => {
    expect(authorInitials("torvalds")).toBe("T");
  });

  it("ignores extra whitespace", () => {
    expect(authorInitials("  ada   lovelace \t")).toBe("AL");
  });

  it("falls back to a question mark when there is no name", () => {
    expect(authorInitials("")).toBe("?");
    expect(authorInitials("   ")).toBe("?");
  });

  it("handles non-Latin names and surrogate pairs", () => {
    expect(authorInitials("Борис Иванов")).toBe("БИ");
    expect(authorInitials("山田 太郎")).toBe("山太");
    expect(authorInitials("😀 smile")).toBe("😀S");
  });
});

describe("authorColor", () => {
  it("is stable for the same name", () => {
    expect(authorColor("Ada Lovelace")).toBe(authorColor("Ada Lovelace"));
  });

  it("ignores case and spacing", () => {
    expect(authorColor("  ada   LOVELACE ")).toBe(authorColor("Ada Lovelace"));
  });

  it("differs between names", () => {
    const colors = new Set(["Ada", "Grace", "Linus", "Margaret", "Dennis", "Ken"].map(authorColor));
    expect(colors.size).toBeGreaterThan(3);
  });

  it("returns a neutral colour for an empty name", () => {
    expect(authorColor("")).toBe("hsl(0 0% 50%)");
    expect(authorColor("  ")).toBe("hsl(0 0% 50%)");
  });

  it("produces a valid hsl for non-Latin names", () => {
    expect(authorColor("山田 太郎")).toMatch(/^hsl\(\d{1,3} 55% 55%\)$/);
  });
});

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;
  const ago = (seconds: number) => formatRelativeTime(now / 1000 - seconds, now);

  it("says now under a minute", () => {
    expect(ago(0)).toBe("now");
    expect(ago(59)).toBe("now");
  });

  it("steps through minutes, hours, days, weeks, months and years", () => {
    expect(ago(60)).toBe("1m");
    expect(ago(3 * 60)).toBe("3m");
    expect(ago(3599)).toBe("59m");
    expect(ago(3600)).toBe("1h");
    expect(ago(2 * 3600)).toBe("2h");
    expect(ago(86_399)).toBe("23h");
    expect(ago(86_400)).toBe("1d");
    expect(ago(5 * 86_400)).toBe("5d");
    expect(ago(7 * 86_400)).toBe("1w");
    expect(ago(21 * 86_400)).toBe("3w");
    expect(ago(30 * 86_400)).toBe("1mo");
    expect(ago(244 * 86_400)).toBe("8mo");
    expect(ago(364 * 86_400)).toBe("11mo");
    expect(ago(365 * 86_400)).toBe("1y");
    expect(ago(2 * 365 * 86_400 + 5)).toBe("2y");
  });

  it("treats future timestamps as now", () => {
    expect(ago(-3600)).toBe("now");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders a local date and time", () => {
    const text = formatAbsoluteTime(1_700_000_000, "en-US", "UTC");
    expect(text).toContain("Nov 14, 2023");
    expect(text).toMatch(/10:13/);
  });
});

describe("isMergeCommit", () => {
  it("needs two or more parents", () => {
    expect(isMergeCommit({ parents: [] })).toBe(false);
    expect(isMergeCommit({ parents: ["a"] })).toBe(false);
    expect(isMergeCommit({ parents: ["a", "b"] })).toBe(true);
  });
});

describe("orderGraphRefs", () => {
  const refs = [
    { name: "v1.0", kind: "tag" },
    { name: "origin/main", kind: "remote" },
    { name: "main", kind: "local" },
    { name: "feature", kind: "local" },
  ];

  it("orders local, remote, then tag and keeps order within a kind", () => {
    expect(orderGraphRefs(refs, false).map((ref) => ref.name)).toEqual([
      "main",
      "feature",
      "origin/main",
      "v1.0",
    ]);
  });

  it("marks the first local branch of the HEAD commit as current", () => {
    const chips = orderGraphRefs(refs, true);
    expect(chips.filter((chip) => chip.current).map((chip) => chip.name)).toEqual(["main"]);
  });

  it("marks nothing on a detached HEAD or other commits", () => {
    expect(orderGraphRefs([{ name: "v1", kind: "tag" }], true)[0]?.current).toBe(false);
    expect(orderGraphRefs(refs, false).some((chip) => chip.current)).toBe(false);
  });
});

describe("splitRefsForBudget", () => {
  const ref = (name: string) => ({ name, kind: "local" });

  it("shows everything that fits", () => {
    const { shown, hidden } = splitRefsForBudget([ref("main"), ref("dev")], 300, 104);
    expect(shown).toHaveLength(2);
    expect(hidden).toHaveLength(0);
  });

  it("moves the rest behind +N when the budget runs out", () => {
    const refs = [ref("main"), ref("feature/a"), ref("feature/b"), ref("feature/c")];
    const { shown, hidden } = splitRefsForBudget(refs, 120, 104);
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length + hidden.length).toBe(4);
    expect(hidden.length).toBeGreaterThan(0);
  });

  it("always shows the first pill, even in a tiny budget", () => {
    const { shown, hidden } = splitRefsForBudget(
      [ref("a-very-long-branch-name"), ref("b")],
      10,
      104,
    );
    expect(shown.map((r) => r.name)).toEqual(["a-very-long-branch-name"]);
    expect(hidden.map((r) => r.name)).toEqual(["b"]);
  });

  it("keeps the last ref visible without reserving room for +N", () => {
    const { hidden } = splitRefsForBudget(
      [ref("main"), ref("dev")],
      16 + 4 * 5.6 + 4 + 16 + 3 * 5.6,
      104,
    );
    expect(hidden).toHaveLength(0);
  });

  it("handles no refs", () => {
    expect(splitRefsForBudget([], 100, 104)).toEqual({ shown: [], hidden: [] });
  });
});
