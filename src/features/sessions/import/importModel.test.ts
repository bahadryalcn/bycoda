import { describe, expect, it } from "vitest";
import type { ImportCandidate } from "../../../platform/tauri/sessionImport";
import {
  candidateKey,
  countSelection,
  dominantRoot,
  filterCandidates,
  groupByFolder,
  importedSessionId,
  isAlreadyImported,
  type ImportFilters,
} from "./importModel";

function candidate(overrides: Partial<ImportCandidate>): ImportCandidate {
  return {
    provider: "claude",
    path: "C:/store/a.jsonl",
    providerSessionId: "id-a",
    cwd: "G:\\Projects\\app",
    cwdExists: true,
    resumable: true,
    firstPrompt: "Fix the login bug",
    startedAt: 1_000,
    lastAt: 2_000,
    sizeBytes: 4_096,
    kind: "interactive",
    model: null,
    archived: false,
    ...overrides,
  };
}

const everything: ImportFilters = {
  providers: new Set(["claude", "codex"]),
  text: "",
  root: null,
  showAutomation: false,
};

describe("filterCandidates", () => {
  const list = [
    candidate({}),
    candidate({
      providerSessionId: "b",
      provider: "codex",
      cwd: "C:\\Users\\me\\x",
    }),
    candidate({ providerSessionId: "c", kind: "exec" }),
    candidate({ providerSessionId: "d", kind: "subagent" }),
  ];

  it("hides automation runs and subagent threads until asked", () => {
    expect(filterCandidates(list, everything).map((c) => c.providerSessionId)).toEqual([
      "id-a",
      "b",
    ]);
    expect(filterCandidates(list, { ...everything, showAutomation: true })).toHaveLength(4);
  });

  it("filters by provider, folder root and text", () => {
    const only = (filters: Partial<ImportFilters>) =>
      filterCandidates(list, { ...everything, ...filters }).map((c) => c.providerSessionId);
    expect(only({ providers: new Set(["codex"]) })).toEqual(["b"]);
    expect(only({ root: "G:/" })).toEqual(["id-a"]);
    expect(only({ root: "g:/projects" })).toEqual(["id-a"]);
    expect(only({ text: "LOGIN" })).toEqual(["id-a", "b"]);
    expect(only({ text: "users/me" })).toEqual(["b"]);
  });
});

describe("groupByFolder", () => {
  it("groups case-insensitively and orders by latest activity", () => {
    const groups = groupByFolder([
      candidate({ providerSessionId: "1", cwd: "g:\\Projects\\app", lastAt: 10 }),
      candidate({
        providerSessionId: "2",
        cwd: "G:\\Projects\\other",
        lastAt: 50,
      }),
      candidate({
        providerSessionId: "3",
        cwd: "G:\\Projects\\APP",
        lastAt: 30,
        cwdExists: false,
      }),
    ]);
    expect(groups.map((g) => [g.path, g.items.map((i) => i.providerSessionId)])).toEqual([
      ["G:/Projects/other", ["2"]],
      ["G:/Projects/APP", ["3", "1"]],
    ]);
    expect(groups[0].lastAt).toBe(50);
  });

  it("reports a folder as missing only when no conversation found it", () => {
    const [group] = groupByFolder([
      candidate({ cwdExists: false }),
      candidate({ providerSessionId: "x", cwdExists: true }),
    ]);
    expect(group.exists).toBe(true);
    expect(groupByFolder([candidate({ cwdExists: false })])[0].exists).toBe(false);
  });
});

describe("dominantRoot", () => {
  it("names the busiest drive, and nothing when there is only one", () => {
    expect(
      dominantRoot([
        candidate({ cwd: "g:\\a" }),
        candidate({ cwd: "G:\\b" }),
        candidate({ cwd: "C:\\c" }),
      ]),
    ).toBe("G:/");
    expect(dominantRoot([candidate({ cwd: "G:\\a" })])).toBeNull();
  });
});

describe("already imported", () => {
  const c = candidate({ provider: "codex", providerSessionId: "abc" });

  it("matches a bound provider conversation or an earlier import's id", () => {
    expect(isAlreadyImported(c, new Set([candidateKey(c)]))).toBe(true);
    expect(isAlreadyImported(c, new Set([importedSessionId(c)]))).toBe(true);
    expect(isAlreadyImported(c, new Set(["claude:abc"]))).toBe(false);
  });

  it("counts only what an import would add", () => {
    const fresh = candidate({ providerSessionId: "fresh", sizeBytes: 100 });
    const done = candidate({ providerSessionId: "done", sizeBytes: 900 });
    const other = candidate({
      providerSessionId: "other",
      cwd: "G:\\elsewhere",
    });
    const counts = countSelection(
      [fresh, done, other],
      new Set([candidateKey(fresh), candidateKey(done)]),
      new Set([candidateKey(done)]),
    );
    expect(counts).toEqual({
      toImport: 1,
      alreadyImported: 1,
      folders: 1,
      bytes: 100,
    });
  });
});
