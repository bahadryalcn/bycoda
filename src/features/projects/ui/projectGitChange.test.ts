import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROJECT_GIT_DETAIL_BUCKETS,
  projectGitChange as readProjectGitChange,
  projectGitChangeSpoken as readProjectGitChangeSpoken,
  projectGitChangeSummary as readProjectGitChangeSummary,
  projectGitCountLabel,
  projectGitDetailBucket,
} from "./projectGitChange";

const t = (text: string, params?: Record<string, string | number>) =>
  text.replace(/\{p(\d)\}/g, (_, index) => String(params?.[`p${index}`] ?? ""));

const formatCount = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("en-US", options).format(value);
const projectGitChange = (stats: Parameters<typeof readProjectGitChange>[0]) =>
  readProjectGitChange(stats, formatCount);
const projectGitChangeSummary = (
  change: Parameters<typeof readProjectGitChangeSummary>[0],
  translate: typeof t,
) => readProjectGitChangeSummary(change, translate, formatCount);
const projectGitChangeSpoken = (
  change: Parameters<typeof readProjectGitChangeSpoken>[0],
  translate: typeof t,
) => readProjectGitChangeSpoken(change, translate, formatCount);

describe("projectGitChange", () => {
  it("claims nothing without data or for a clean tree", () => {
    expect(projectGitChange(null)).toBeNull();
    expect(projectGitChange(undefined)).toBeNull();
    expect(projectGitChange({ files: 0, additions: 0, deletions: 0 })).toBeNull();
  });

  it("keeps real file changes that carry no line counts", () => {
    const change = projectGitChange({ files: 3, additions: 0, deletions: 0 });
    expect(change).toMatchObject({ files: 3, hasLines: false, detail: "" });
    expect(projectGitChangeSummary(change!, t)).toBe("3 files");
    expect(projectGitChangeSpoken(change!, t)).toBe("3 changed files");
    expect(projectGitDetailBucket(change!)).toBeNull();
  });

  it("names files and lines separately and never mixes them", () => {
    const change = projectGitChange({ files: 1, additions: 120149, deletions: 1344 })!;
    expect(change.detail).toBe("+120,149 -1,344");
    expect(projectGitChangeSummary(change, t)).toBe("1 file · +120,149 -1,344");
    expect(projectGitChangeSpoken(change, t)).toBe(
      "1 changed file, 120,149 lines added, 1,344 lines removed",
    );
  });

  it("does not invent a file count when the data has none", () => {
    const change = projectGitChange({ files: 0, additions: 8, deletions: 0 })!;
    expect(change.files).toBe(0);
    expect(projectGitChangeSummary(change, t)).toBe("+8");
    expect(projectGitChangeSpoken(change, t)).toBe("8 lines added");
  });

  it("ignores invalid numbers instead of showing them", () => {
    expect(projectGitChange({ files: Number.NaN, additions: -4, deletions: Infinity })).toBeNull();
    expect(projectGitChange({ files: 2.9, additions: 0, deletions: 0 })?.files).toBe(2);
  });

  it("caps the visible file count and keeps the exact number in text", () => {
    expect(projectGitCountLabel(7)).toBe("7");
    expect(projectGitCountLabel(99)).toBe("99");
    expect(projectGitCountLabel(1234)).toBe("99+");
    const change = projectGitChange({ files: 1234, additions: 1, deletions: 0 })!;
    expect(projectGitChangeSummary(change, t)).toContain("1,234 files");
  });
});

describe("projectGitDetailBucket", () => {
  it("asks for more row width as the detail and the fixed row items grow", () => {
    const small = projectGitChange({ files: 1, additions: 8, deletions: 0 })!;
    const large = projectGitChange({ files: 9, additions: 301861, deletions: 12345 })!;
    const smallBucket = projectGitDetailBucket(small)!;
    const largeBucket = projectGitDetailBucket(large)!;
    expect(smallBucket).toBeLessThan(largeBucket);
    expect(projectGitDetailBucket(small, 2)!).toBeGreaterThan(smallBucket);
    expect(PROJECT_GIT_DETAIL_BUCKETS).toContain(smallBucket as never);
  });

  it("stays compact for huge values no rail width can hold", () => {
    const huge = projectGitChange({
      files: 90000,
      additions: 123456789012,
      deletions: 987654321098,
    })!;
    expect(projectGitDetailBucket(huge, 2)).toBeNull();
  });

  it("has a container-query rule for every bucket in the rail row stylesheet", () => {
    const css = readFileSync(
      new URL("../../../app/shell/projectRailRow.css", import.meta.url),
      "utf8",
    );
    for (const bucket of PROJECT_GIT_DETAIL_BUCKETS) {
      expect(css).toContain(`@container project-row (width >= ${bucket}px)`);
      expect(css).toContain(`[data-git-bucket="${bucket}"] [data-git-detail]`);
    }
  });
});

it("uses the supplied locale consistently for visible detail, summaries and spoken counts", () => {
  const format = (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("tr", options).format(value);
  const change = readProjectGitChange({ files: 1234, additions: 120149, deletions: 1344 }, format)!;
  expect(change.detail).toBe("+120.149 -1.344");
  expect(readProjectGitChangeSummary(change, t, format)).toBe("1.234 files · +120.149 -1.344");
  expect(readProjectGitChangeSpoken(change, t, format)).toBe(
    "1.234 changed files, 120.149 lines added, 1.344 lines removed",
  );
  expect(change.files).toBe(1234);
  expect(change.additions).toBe(120149);
});
