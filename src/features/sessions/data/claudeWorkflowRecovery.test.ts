import { describe, expect, it, vi } from "vitest";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import { newSession } from "../model/session";
import { recoverClaudeWorkflows } from "./claudeWorkflowRecovery";

describe("recoverClaudeWorkflows", () => {
  it("uses the original account, worktree and exact call before restoring children", async () => {
    const base = {
      ...newSession("claude", "/project"),
      worktreeCwd: "/worktree",
      providerAccountId: "account-a",
    };
    const saved = applyHarnessEvent(base, {
      type: "tool.started",
      callId: "toolu_old",
      title: "Old workflow",
      kind: "agent",
      status: "in_progress",
    });
    const lookup = vi.fn(async () => ({
      providerSessionId: "old-session",
      runId: "wf_1",
      status: "completed" as const,
    }));
    const load = vi.fn(
      async (
        input: Parameters<
          typeof import("../../../integrations/harness/providers/claude/claudeWorkflowArtifacts").loadClaudeWorkflowArtifacts
        >[0],
      ) => {
        input.onEvent({
          type: "tool.started",
          callId: "workflow:toolu_old:a",
          title: "Child",
          kind: "agent",
          status: "interrupted",
          workflow: { callId: "toolu_old", phase: "Review" },
        });
      },
    );
    const recovered = await recoverClaudeWorkflows(saved, { lookup, load });
    expect(lookup).toHaveBeenCalledWith({
      cwd: "/worktree",
      providerAccountId: "account-a",
      callId: "toolu_old",
    });
    expect(
      recovered.blocks.find((block) => block.tool?.callId === "toolu_old")?.tool,
    ).toMatchObject({ kind: "Workflow", status: "completed" });
    expect(
      recovered.blocks.find((block) => block.tool?.callId === "workflow:toolu_old:a")?.agentRun
        ?.workflow,
    ).toEqual({ callId: "toolu_old", phase: "Review" });
    await recoverClaudeWorkflows(recovered, { lookup, load });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("does not attach ambiguous results or look up a host-owned session", async () => {
    const saved = applyHarnessEvent(newSession("claude", "/project"), {
      type: "tool.started",
      callId: "toolu_old",
      title: "Agent",
      kind: "agent",
      status: "completed",
    });
    const lookup = vi.fn(async () => null);
    expect(await recoverClaudeWorkflows(saved, { lookup })).toBe(saved);
    expect(lookup).not.toHaveBeenCalled();
    const interrupted = applyHarnessEvent(saved, {
      type: "tool.updated",
      callId: "toolu_old",
      status: "interrupted",
    });
    expect(await recoverClaudeWorkflows(interrupted, { lookup })).toBe(interrupted);
    expect(lookup).not.toHaveBeenCalled();
    const workflow = applyHarnessEvent(interrupted, {
      type: "tool.updated",
      callId: "toolu_old",
      title: "Workflow",
      status: "interrupted",
    });
    expect(await recoverClaudeWorkflows(workflow, { lookup })).toBe(workflow);
    expect(lookup).toHaveBeenCalledOnce();
    const bound = {
      ...workflow,
      hostBinding: {} as NonNullable<typeof workflow.hostBinding>,
    };
    expect(await recoverClaudeWorkflows(bound, { lookup })).toBe(bound);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("stops waiting at the shared deadline without starting another lookup", async () => {
    vi.useFakeTimers();
    try {
      const first = applyHarnessEvent(newSession("claude", "/project"), {
        type: "tool.started",
        callId: "one",
        title: "Workflow",
        kind: "agent",
        status: "interrupted",
      });
      const saved = applyHarnessEvent(first, {
        type: "tool.started",
        callId: "two",
        title: "Workflow",
        kind: "agent",
        status: "interrupted",
      });
      const lookup = vi.fn(() => new Promise<null>(() => undefined));
      const pending = recoverClaudeWorkflows(saved, { lookup });
      await vi.advanceTimersByTimeAsync(4_001);
      expect(await pending).toBe(saved);
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
