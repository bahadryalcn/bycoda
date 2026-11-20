import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { claudeWorkflowArtifacts, resolveClaudeWorkflow } from "./claude-workflow-artifacts";

vi.mock("./provider-accounts", () => ({ providerAccountEnvironment: vi.fn(async () => null) }));

const session = "d0897ea8-f733-472a-bc5e-869c3fb23027";
const runId = "wf_6e2a3c4b-343";
const cwd = resolve("workflow project");
const originalConfig = process.env.CLAUDE_CONFIG_DIR;
let root = "";

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "claude-workflows-"));
  process.env.CLAUDE_CONFIG_DIR = root;
  const project = Array.from(cwd, (char) => (/[A-Za-z0-9]/.test(char) ? char : "-")).join("");
  const directory = join(root, "projects", project, session, "subagents", "workflows", runId);
  await mkdir(directory, { recursive: true });
  return directory;
}

afterEach(async () => {
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfig;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("legacy Workflow resolver", () => {
  const callId = "toolu_123";
  const records = [
    {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: callId, name: "Workflow" }] },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: callId }] },
      toolUseResult: { taskType: "local_workflow", taskId: "task-1", runId },
    },
    {
      type: "user",
      origin: { kind: "task-notification", producer: "session-task" },
      message: {
        content:
          "<task-notification><task-id>task-1</task-id><status>completed</status></task-notification>",
      },
    },
  ];
  const jsonl = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n") + "\n";
  it("resolves only the exact call and authenticated task notification", async () => {
    const dir = await fixture();
    const project = dirname(dirname(dirname(dirname(dir))));
    await writeFile(join(project, `${session}.jsonl`), jsonl(records));
    expect(await resolveClaudeWorkflow({ cwd, callId })).toEqual({
      providerSessionId: session,
      runId,
      status: "completed",
    });
    expect(await resolveClaudeWorkflow({ cwd, callId: "other" })).toBeNull();
    expect(await resolveClaudeWorkflow({ cwd, callId, providerSessionId: session })).toEqual({
      providerSessionId: session,
      runId,
      status: "completed",
    });
  });
  it("rejects ambiguity, malformed data and conflicting status", async () => {
    const dir = await fixture();
    const project = dirname(dirname(dirname(dirname(dir))));
    const file = join(project, `${session}.jsonl`);
    await writeFile(file, jsonl([...records, records[1]]));
    expect(await resolveClaudeWorkflow({ cwd, callId })).toBeNull();
    await writeFile(
      file,
      jsonl([
        ...records,
        {
          ...records[2],
          message: {
            content:
              "<task-notification><task-id>task-1</task-id><status>failed</status></task-notification>",
          },
        },
      ]),
    );
    expect(await resolveClaudeWorkflow({ cwd, callId })).toBeNull();
    await writeFile(file, `${jsonl(records)}{`);
    expect(await resolveClaudeWorkflow({ cwd, callId })).toBeNull();
    await expect(resolveClaudeWorkflow({ cwd, callId: "../x" })).rejects.toThrow("Invalid");
  });
  it("fails closed when a transcript exceeds the scan limit", async () => {
    const dir = await fixture();
    const project = dirname(dirname(dirname(dirname(dir))));
    const file = await open(join(project, `${session}.jsonl`), "w");
    try {
      await file.truncate(16 * 1024 * 1024 + 1);
    } finally {
      await file.close();
    }
    expect(await resolveClaudeWorkflow({ cwd, callId })).toBeNull();
  });
});

describe("Claude Workflow artifacts", () => {
  it("reads matching pairs and trims partial first transcript line", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "agent-a123.meta.json"), '{"phase":"review"}');
    await writeFile(join(dir, "agent-a123.jsonl"), `${"x".repeat(65_536)}\n{"text":"last"}\n`);
    await writeFile(join(dir, "agent-missing.meta.json"), "{}");
    expect(await claudeWorkflowArtifacts({ cwd, providerSessionId: session, runId })).toEqual([
      { agentId: "a123", metadata: '{"phase":"review"}', transcript: '{"text":"last"}\n' },
    ]);
  });

  it("rejects malformed identifiers and traversal", async () => {
    for (const bad of ["../secret", "wf_../secret", "wf_"]) {
      await expect(
        claudeWorkflowArtifacts({ cwd, providerSessionId: session, runId: bad }),
      ).rejects.toThrow("Invalid");
    }
    await expect(
      claudeWorkflowArtifacts({ cwd, providerSessionId: `${session}/..`, runId }),
    ).rejects.toThrow("Invalid");
  });

  it("rejects a directory link outside the account root", async () => {
    const dir = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "workflow-outside-"));
    try {
      await rm(dir, { recursive: true });
      await symlink(outside, dir, "junction");
      await expect(
        claudeWorkflowArtifacts({ cwd, providerSessionId: session, runId }),
      ).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
