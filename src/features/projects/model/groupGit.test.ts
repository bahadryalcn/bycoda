import { describe, expect, it } from "vitest";
import { fetchAllProjects, summarizeGroupGit } from "./groupGit";

describe("summarizeGroupGit", () => {
  it("counts dirty local projects and skips remote ones", () => {
    expect(
      summarizeGroupGit([
        { remote: false, files: 3 },
        { remote: false, files: 0 },
        { remote: true, files: 9 },
        { remote: false, files: null },
      ]),
    ).toEqual({
      local: 3,
      remote: 1,
      known: 2,
      dirty: 1,
      files: 3,
      ahead: 0,
      behind: 0,
      syncKnown: 0,
    });
  });

  it("totals ahead and behind only where both are known", () => {
    const summary = summarizeGroupGit([
      { remote: false, files: 1, ahead: 2, behind: 1 },
      { remote: false, files: 0, ahead: 3, behind: null },
      { remote: false, files: 0, ahead: 0, behind: 4 },
      { remote: true, files: null, ahead: 9, behind: 9 },
    ]);
    expect(summary.ahead).toBe(2);
    expect(summary.behind).toBe(5);
    expect(summary.syncKnown).toBe(2);
  });

  it("handles an empty group", () => {
    expect(summarizeGroupGit([]).local).toBe(0);
  });
});

describe("fetchAllProjects", () => {
  it("runs sequentially and keeps going after a failure", async () => {
    const order: string[] = [];
    let active = 0;
    let overlapped = false;
    const results = await fetchAllProjects(["a", "b", "c"], {
      hasRemote: async (path) => path !== "c",
      fetch: async (path) => {
        active += 1;
        overlapped ||= active > 1;
        order.push(path);
        await Promise.resolve();
        active -= 1;
        if (path === "a") throw new Error("offline");
      },
    });
    expect(overlapped).toBe(false);
    expect(order).toEqual(["a", "b"]);
    expect(results).toEqual([
      { path: "a", status: "failed", error: "offline" },
      { path: "b", status: "fetched" },
      { path: "c", status: "no-remote" },
    ]);
  });

  it("records a failing remote lookup and stops when cancelled", async () => {
    let cancelled = false;
    const results = await fetchAllProjects(
      ["a", "b"],
      {
        hasRemote: async () => {
          cancelled = true;
          throw new Error("not a repository");
        },
        fetch: async () => undefined,
      },
      undefined,
      () => cancelled,
    );
    expect(results).toEqual([{ path: "a", status: "failed", error: "not a repository" }]);
  });
});
