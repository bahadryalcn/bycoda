// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ClaudeTranscript,
  CodexTranscript,
  ImportCandidate,
} from "../../../platform/tauri/sessionImport";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../../projects/model/projectGroups";
import { loadRecents, rememberProject } from "../../projects/model/recents";
import type { SessionSummary } from "../data/sessionStore";
import type { Block, Session } from "../model/session";
import { candidateKey, importedSessionId } from "./importModel";
import {
  fitBlocks,
  previewProjectGroups,
  runSessionImport,
  type ImportDeps,
  type ImportProgress,
} from "./importRunner";

beforeEach(() => localStorage.clear());

function candidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    provider: "claude",
    path: "C:/store/one.jsonl",
    providerSessionId: "conv-1",
    cwd: "G:\\Projects\\Acme\\alpha",
    cwdExists: true,
    resumable: true,
    firstPrompt: "Fix the login bug",
    startedAt: 1_700_000_000_000,
    lastAt: 1_700_000_900_000,
    sizeBytes: 2_048,
    kind: "interactive",
    model: null,
    archived: false,
    ...overrides,
  };
}

const claudeText = [
  { type: "user", message: { role: "user", content: "Fix the login bug" } },
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
  },
]
  .map((record) => JSON.stringify(record))
  .join("\n");

type Harness = {
  deps: ImportDeps;
  persisted: { session: Session; times: { createdAt: number; updatedAt: number } }[];
  stored: Set<string>;
  placeholders: string[];
};

function harness(overrides: Partial<ImportDeps> = {}): Harness {
  const persisted: Harness["persisted"] = [];
  const stored = new Set<string>();
  const placeholders: string[] = [];
  const deps: ImportDeps = {
    readClaude: async (): Promise<ClaudeTranscript> => ({
      text: claudeText,
      truncated: false,
      totalRecords: 2,
      keptRecords: 2,
      oversizeSkipped: 0,
    }),
    readCodex: async (): Promise<CodexTranscript> => ({
      entries: [
        { kind: "user", at: 5, text: "Add pagination" },
        { kind: "assistant", at: 6, text: "Added." },
      ],
      truncated: false,
      dropped: 0,
      oversizeSkipped: 0,
    }),
    placeholderDir: async (original) => {
      placeholders.push(original);
      return `C:/app/imported-history/Missing folder - ${placeholders.length}`;
    },
    persist: async (session, times) => {
      if (stored.has(session.id)) return null;
      stored.add(session.id);
      persisted.push({ session, times });
      return {} as SessionSummary;
    },
    storedKeys: async () => [...stored],
    forgetReplay: () => undefined,
    yieldToUi: async () => undefined,
    ...overrides,
  };
  return { deps, persisted, stored, placeholders };
}

async function run(
  h: Harness,
  candidates: ImportCandidate[],
  extra: {
    groupProjects?: boolean;
    signal?: AbortSignal;
    onProgress?: (p: ImportProgress) => void;
  } = {},
) {
  return runSessionImport({
    candidates,
    groupProjects: extra.groupProjects ?? true,
    signal: extra.signal ?? new AbortController().signal,
    onProgress: extra.onProgress ?? (() => undefined),
    deps: h.deps,
  });
}

describe("runSessionImport", () => {
  it("imports a Claude conversation resumable, with its original timestamps", async () => {
    const h = harness();
    const summary = await run(h, [candidate()]);

    expect(summary).toMatchObject({ imported: 1, skipped: 0, readOnly: 0 });
    const { session, times } = h.persisted[0];
    expect(session.id).toBe("imp-claude-conv-1");
    expect(session.harness).toBe("claude");
    expect(session.cwd).toBe("G:/Projects/Acme/alpha");
    expect(session.providerSessionId).toBe("conv-1");
    expect(session.title).toBe("claude · Fix the login bug");
    expect(times).toEqual({
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_900_000,
    });
    expect(session.blocks.map((b) => b.role)).toEqual(["system", "user", "assistant"]);
    expect(session.blocks[0].text).toContain("continues the same conversation");
    expect(session.blocks[1].startedAt).toBeUndefined();
  });

  it("imports a Codex rollout bound to its thread", async () => {
    const h = harness();
    await run(h, [
      candidate({
        provider: "codex",
        providerSessionId: "thread-9",
        model: "gpt-5.4",
      }),
    ]);
    const { session } = h.persisted[0];
    expect(session.harness).toBe("codex");
    expect(session.providerSessionId).toBe("thread-9");
    expect(session.blocks.map((b) => b.role)).toEqual(["system", "user", "assistant"]);
    expect(session.blocks[0].text).toContain("Codex thread");
  });

  it("files a conversation whose folder is gone under a placeholder, read-only", async () => {
    const h = harness();
    const summary = await run(h, [candidate({ cwd: "G:\\gone\\old", cwdExists: false })]);
    const { session } = h.persisted[0];
    expect(session.cwd).toBe("C:/app/imported-history/Missing folder - 1");
    expect(session.providerSessionId).toBeUndefined();
    expect(session.blocks[0].text).toContain("no longer exists");
    expect(summary.readOnly).toBe(1);
    // The placeholder is a real folder, so it is registered; the dead one is not.
    expect(loadRecents().map((p) => p.path)).toEqual([
      "C:/app/imported-history/Missing folder - 1",
    ]);
  });

  it("does not bind a Claude transcript that does not map to its folder", async () => {
    const h = harness();
    await run(h, [candidate({ resumable: false })]);
    const { session } = h.persisted[0];
    expect(session.providerSessionId).toBeUndefined();
    expect(session.blocks[0].text).toContain("could not be matched");
  });

  it("notes a truncated transcript instead of failing", async () => {
    const h = harness({
      readClaude: async () => ({
        text: claudeText,
        truncated: true,
        totalRecords: 900,
        keptRecords: 2,
        oversizeSkipped: 0,
      }),
    });
    const summary = await run(h, [candidate()]);
    expect(summary.truncated).toBe(1);
    expect(h.persisted[0].session.blocks[0].text).toContain("most recent part");
  });

  it("is idempotent: a second run imports nothing and writes nothing", async () => {
    const h = harness();
    const list = [candidate(), candidate({ providerSessionId: "conv-2" })];
    expect((await run(h, list)).imported).toBe(2);
    const again = await run(h, list);
    expect(again).toMatchObject({ imported: 0, skipped: 2 });
    expect(h.persisted).toHaveLength(2);
  });

  it("skips what Bycoda already holds, by provider conversation", async () => {
    const h = harness({
      storedKeys: async () => [candidateKey(candidate())],
    });
    const summary = await run(h, [candidate()]);
    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(h.persisted).toHaveLength(0);
  });

  it("reports a failing conversation and carries on with the rest", async () => {
    const h = harness({
      readClaude: async (path) => {
        if (path.includes("bad")) throw new Error("unreadable");
        return {
          text: claudeText,
          truncated: false,
          totalRecords: 2,
          keptRecords: 2,
          oversizeSkipped: 0,
        };
      },
    });
    const summary = await run(h, [
      candidate({ path: "C:/store/bad.jsonl", providerSessionId: "bad" }),
      candidate({ providerSessionId: "good" }),
    ]);
    expect(summary.imported).toBe(1);
    expect(summary.failed.map((f) => [f.candidate.providerSessionId, f.error])).toEqual([
      ["bad", "unreadable"],
    ]);
  });

  it("fails a conversation that has nothing a person said", async () => {
    const h = harness({
      readClaude: async () => ({
        text: "",
        truncated: false,
        totalRecords: 0,
        keptRecords: 0,
        oversizeSkipped: 0,
      }),
    });
    const summary = await run(h, [candidate()]);
    expect(summary.failed).toHaveLength(1);
    expect(loadRecents()).toEqual([]);
  });

  it("stops when cancelled but still registers what was imported", async () => {
    const h = harness();
    const controller = new AbortController();
    const summary = await run(
      h,
      [
        candidate({ providerSessionId: "a" }),
        candidate({ providerSessionId: "b" }),
        candidate({ providerSessionId: "c" }),
      ],
      {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.done === 1) controller.abort();
        },
      },
    );
    expect(summary).toMatchObject({ imported: 1, cancelled: true });
    expect(loadRecents()).toHaveLength(1);
  });

  it("registers each existing folder as a project and groups siblings by parent", async () => {
    rememberProject("G:/Projects/mine");
    const h = harness();
    const summary = await run(h, [
      candidate({ providerSessionId: "1", cwd: "G:\\Projects\\Acme\\alpha" }),
      candidate({ providerSessionId: "2", cwd: "g:\\Projects\\Acme\\beta" }),
      candidate({ providerSessionId: "3", cwd: "G:\\Projects\\Acme\\beta" }),
      candidate({ providerSessionId: "4", cwd: "G:\\Projects\\lonely\\gamma" }),
    ]);

    expect(summary.projects).toBe(3);
    expect(summary.groups).toEqual(["Acme"]);
    // Same folder in two spellings is one project, and imported ones sit
    // after the project the user already had.
    const paths = loadRecents().map((p) => p.path);
    expect(paths[0]).toBe("G:/Projects/mine");
    expect(paths.slice(1).sort()).toEqual([
      "G:/Projects/Acme/alpha",
      "G:/Projects/Acme/beta",
      "G:/Projects/lonely/gamma",
    ]);
    const assignments = loadProjectGroupAssignments();
    expect(Object.keys(assignments).sort()).toEqual([
      "g:/projects/acme/alpha",
      "g:/projects/acme/beta",
    ]);
    expect(loadProjectGroups().map((g) => g.name)).toEqual(["Acme"]);
  });

  it("never moves a project the user already placed in a group", async () => {
    saveProjectGroups([{ id: "mine", name: "Mine", collapsed: false }]);
    saveProjectGroupAssignments({ "g:/projects/acme/alpha": "mine" });
    const h = harness();
    await run(h, [
      candidate({ providerSessionId: "1", cwd: "G:\\Projects\\Acme\\alpha" }),
      candidate({ providerSessionId: "2", cwd: "G:\\Projects\\Acme\\beta" }),
    ]);
    expect(loadProjectGroupAssignments()).toEqual({
      "g:/projects/acme/alpha": "mine",
    });
  });

  it("leaves projects ungrouped when grouping is turned off", async () => {
    const h = harness();
    await run(
      h,
      [
        candidate({ providerSessionId: "1", cwd: "G:\\Projects\\Acme\\alpha" }),
        candidate({ providerSessionId: "2", cwd: "G:\\Projects\\Acme\\beta" }),
      ],
      { groupProjects: false },
    );
    expect(loadProjectGroups()).toEqual([]);
    expect(loadRecents()).toHaveLength(2);
  });

  it("derives the session id from the provider id", () => {
    expect(importedSessionId(candidate({ provider: "codex", providerSessionId: "x" }))).toBe(
      "imp-codex-x",
    );
  });
});

describe("previewProjectGroups", () => {
  it("shows the groups the import would create, missing folders apart", () => {
    const groups = previewProjectGroups([
      candidate({ cwd: "G:\\Projects\\Acme\\alpha" }),
      candidate({ cwd: "G:\\Projects\\Acme\\beta" }),
      candidate({ cwd: "G:\\a\\gone", cwdExists: false }),
      candidate({ cwd: "G:\\b\\gone", cwdExists: false }),
    ]);
    expect(groups).toEqual([
      { name: "Acme", count: 2 },
      { name: "Missing folders", count: 2 },
    ]);
  });
});

describe("fitBlocks", () => {
  const block = (id: number): Block => ({
    id: String(id),
    role: "assistant",
    text: "x".repeat(1_000),
  });

  it("drops the oldest blocks until the transcript fits", () => {
    const blocks = Array.from({ length: 50 }, (_, index) => block(index));
    const fitted = fitBlocks(blocks, 20_000);
    expect(fitted.trimmed).toBe(true);
    expect(JSON.stringify(fitted.blocks).length).toBeLessThanOrEqual(20_000);
    expect(fitted.blocks.at(-1)?.id).toBe("49");
  });

  it("leaves a transcript that fits alone", () => {
    const blocks = [block(1), block(2)];
    expect(fitBlocks(blocks)).toEqual({ blocks, trimmed: false });
  });
});
