import { describe, expect, it } from "vitest";
import { voiceLiveResults } from "./voiceLiveWork";
import { currentExecutionTools } from "../../sessions/public/commandInspection";
import type { Session } from "../../sessions/public/session";

const blocks: Session["blocks"] = [
  { id: "old", role: "user", text: "Old request" },
  { id: "old-tool", role: "tool", text: "" },
  { id: "new", role: "user", text: "Run tests" },
  { id: "command", role: "tool", text: "" },
  { id: "draft", role: "user", text: "Unsubmitted draft", draft: true },
];

function command(id: string, text: string, status: string, detail = ""): Session["blocks"][number] {
  return {
    id,
    role: "tool",
    text: "",
    tool: {
      status,
      detail,
      preview: { inspection: { kind: "command", text } },
    },
  } as Session["blocks"][number];
}

function results(...tools: Session["blocks"]) {
  return voiceLiveResults(
    { busy: false, blocks: [{ id: "turn", role: "user", text: "Go" }, ...tools] },
    [],
  );
}

describe("voice live work", () => {
  it("surfaces only tools in the latest submitted turn", () => {
    expect(currentExecutionTools(blocks).tools.map(({ id }) => id)).toEqual(["command"]);
  });
});

describe("voice live results", () => {
  it("is empty without a settled, recognized outcome", () => {
    expect(voiceLiveResults(undefined, [])).toEqual([]);
    expect(results(command("a", "ls -la", "completed", "secret.txt"))).toEqual([]);
  });

  it("reduces output to counts and never retains command or output text", () => {
    const secret = "sk-live-abcdef123456";
    const parsed = results(
      command(
        "a",
        `API_KEY=${secret} pnpm vitest run`,
        "completed",
        `token ${secret}\n Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 12 passed (13)`,
      ),
    );
    expect(parsed).toEqual([
      { kind: "tests", status: "failed", passed: 12, failed: 1, skipped: 0 },
    ]);
    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  it("sums cargo results and lets the latest run of a kind win", () => {
    const first = command("a", "cargo test", "failed", "test result: FAILED. 1 passed; 2 failed;");
    const second = command(
      "b",
      "cargo test",
      "completed",
      "test result: ok. 3 passed; 0 failed; 1 ignored;\ntest result: ok. 4 passed; 0 failed; 0 ignored;",
    );
    expect(results(first, second)).toEqual([
      { kind: "tests", status: "done", passed: 7, failed: 0, skipped: 1 },
    ]);
  });

  it("does not credit a shared exit status to a build or check", () => {
    expect(results(command("a", "pnpm build | tail -5", "completed"))).toEqual([]);
    expect(results(command("a", "pnpm build && pnpm lint", "completed"))).toEqual([]);
    expect(results(command("a", "cd app && pnpm build", "completed"))).toEqual([
      { kind: "build", status: "done" },
    ]);
  });

  it("reports Git change size and clears a failure when the same command later succeeds", () => {
    expect(
      results(
        command(
          "a",
          "git diff --stat",
          "completed",
          " 3 files changed, 10 insertions(+), 2 deletions(-)",
        ),
      ),
    ).toEqual([{ kind: "changes", status: "done", files: 3, additions: 10, deletions: 2 }]);
    const failed = command("a", "node deploy.js", "failed", "boom");
    expect(results(failed)).toEqual([{ kind: "commands", status: "failed", count: 1 }]);
    expect(results(failed, command("b", "node deploy.js", "completed"))).toEqual([]);
  });

  it("keeps settled allowlisted voice actions and puts failures first", () => {
    const base = { target: "Project", projectPath: "", startedAt: 0 };
    const parsed = voiceLiveResults(
      {
        busy: false,
        blocks: [{ id: "turn", role: "user", text: "Go" }, command("a", "pnpm build", "completed")],
      },
      [
        { ...base, id: "1", name: "notes.create", state: "failed" },
        { ...base, id: "2", name: "workspace.running", state: "running" },
        { ...base, id: "discovery", name: "app_tools_list", state: "returned" },
        { ...base, id: "submit", name: "submit_work", state: "returned" },
        {
          ...base,
          id: "pending",
          name: "workspace.sessions.create",
          outcome: "accepted",
          state: "returned",
        },
        { ...base, id: "3", name: "bad name sk-live", state: "returned" },
      ],
    );
    expect(parsed).toEqual([
      {
        kind: "actions",
        status: "failed",
        actions: [{ id: "1", name: "notes.create", status: "failed" }],
      },
      { kind: "build", status: "done" },
    ]);
  });
});
