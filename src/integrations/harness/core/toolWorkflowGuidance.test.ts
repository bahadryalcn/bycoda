import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TOOL_WORKFLOWS,
  TOOL_WORKFLOW_GUIDANCE_VERSION,
  toolWorkflowGuidance,
} from "./toolWorkflowGuidance";

describe("tool workflow delivery", () => {
  it("routes saved SSH execution through native approval and operation status", () => {
    const hint = toolWorkflowGuidance({ conversation: true, social: false, runtimeLogs: false });
    expect(hint).toContain("servers.ssh.execute with native owner approval");
    expect(hint).toContain("servers.ssh.status for output/exitCode");
    expect(hint).toContain("reuse requestId after uncertain completion");
    expect(hint).toContain("servers.ssh.cancel stops local SSH only");
    expect(hint).toContain("Manual Servers terminals stay private");
    expect(hint).toContain("do not switch to raw ssh to bypass these gates");
  });
  it("does not advertise workflows when no transport is offered", () => {
    expect(toolWorkflowGuidance({ conversation: false, social: false, runtimeLogs: false })).toBe(
      "",
    );
  });

  it("limits disconnected contexts to their actually offered server groups", () => {
    const logs = toolWorkflowGuidance({ conversation: false, social: false, runtimeLogs: true });
    expect(logs).toContain("offered transports: runtime-logs");
    expect(logs).toContain("domain readiness: unknown until checked");
    expect(logs).toContain("runtime-logs: Discover sources");
    expect(logs).not.toContain("browser.preview");
    expect(logs).not.toContain("skills:");
    expect(logs).not.toContain("social:");

    const social = toolWorkflowGuidance({ conversation: false, social: true, runtimeLogs: false });
    expect(social).toContain("policy.get");
    expect(social).toContain("draft/send separation");
    expect(social).not.toContain("runtime-logs:");
    expect(social).not.toContain("conversation_tools_search");
  });

  it("covers every conversation family with bounded guidance and preserves authority", () => {
    const hint = toolWorkflowGuidance({ conversation: true, social: true, runtimeLogs: true });
    expect(new Set(CONVERSATION_TOOL_WORKFLOWS.map(([family]) => family)).size).toBe(29);
    for (const [family] of CONVERSATION_TOOL_WORKFLOWS) expect(hint).toContain(`${family}: `);
    expect(hint.length).toBeLessThan(10_000);
    expect(hint).toContain(TOOL_WORKFLOW_GUIDANCE_VERSION);
    expect(hint).toContain("Reconcile uncertain writes");
    expect(hint).toContain("same request/operation identity");
    expect(hint).toContain("Never bypass permissions");
    expect(hint).toContain("tools.describe");
    expect(hint).toContain("avoid full catalog dumps");
  });

  it("keeps the shared preview visible without treating fallback as takeover authority", () => {
    const hint = toolWorkflowGuidance({ conversation: true, social: false, runtimeLogs: false });
    expect(hint).toContain("browser.preview({requestId,url,show:true})");
    expect(hint).toContain("inspect its page and UI results separately");
    expect(hint).toContain("browser.claim → browser.open → browser.frame");
    expect(hint).toContain("ui.tools.status");
    expect(hint).toContain("browser.resize");
    expect(hint).toContain("two calls fail on the same step");
    expect(hint).toContain("not permission to take over another session");
    expect(hint).toContain("If only one check is unsupported, preserve integrated preview");
    expect(hint).toContain("keep a preview hidden or closed");
  });

  it("offers visual explanations before an explicit HTML request while preserving scope", () => {
    const hint = toolWorkflowGuidance({ conversation: true, social: false, runtimeLogs: false });
    expect(hint).toContain("Use visuals proactively");
    expect(hint).toContain("no explicit HTML request is needed");
    expect(hint).toContain("Keep simple answers as text");
    expect(hint).toContain("preview and inspect the screenshot before rendering the same source");
    expect(hint).toContain("short subject-based title");
    expect(hint).toContain("not app changes or new operation authority");
    const disconnected = toolWorkflowGuidance({
      conversation: false,
      social: false,
      runtimeLogs: true,
    });
    expect(disconnected).not.toContain("visuals.preview/render");
  });
});
