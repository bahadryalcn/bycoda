import { describe, expect, it } from "vitest";
import { TOOL_WORKFLOW_GUIDANCE_VERSION, toolWorkflowGuidance } from "./toolWorkflowGuidance";

describe("tool workflow delivery", () => {
  it("does not advertise workflows when no transport is offered", () => {
    expect(toolWorkflowGuidance({ conversation: false, social: false, runtimeLogs: false })).toBe(
      "",
    );
  });

  it("limits disconnected contexts to their actually offered server groups", () => {
    const logs = toolWorkflowGuidance({ conversation: false, social: false, runtimeLogs: true });
    expect(logs).toContain("offered transports: runtime-logs");
    expect(logs).toContain("domain readiness: unknown until checked");
    expect(logs).toContain("runtime-logs: discover sources");
    expect(logs).not.toContain("browser.preview");
    expect(logs).not.toContain("visuals.");
    expect(logs).not.toContain("social:");

    const social = toolWorkflowGuidance({ conversation: false, social: true, runtimeLogs: false });
    expect(social).toContain("policy.get");
    expect(social).not.toContain("runtime-logs:");
    expect(social).not.toContain("conversation_tools_search");
  });

  it("states the shared contract once and leaves per-tool rules to tool descriptions", () => {
    const hint = toolWorkflowGuidance({ conversation: true, social: true, runtimeLogs: true });
    expect(hint).toContain(TOOL_WORKFLOW_GUIDANCE_VERSION);
    expect(hint).toContain("same requestId");
    expect(hint).toContain("reconcile through status/readback");
    expect(hint).toContain("owner approval inside bycoda");
    expect(hint).toContain("never a platform confirmation dialog");
    expect(hint).toContain("never bypass permissions");
    expect(hint).toContain("conversation_tools_describe");
    expect(hint).toContain("avoid full catalog dumps");
    expect(hint).toContain("browser.preview");
    expect(hint).toContain("visuals.preview then visuals.render");
    expect(hint).toContain("keep simple answers as text");
    // No family-by-family list: the model reads tool descriptions as it needs them.
    expect(hint).not.toContain("servers.ssh.execute");
    expect(hint).not.toContain("devices.control.claim");
    expect(hint.split("\n").length).toBeLessThanOrEqual(6);
    expect(hint.length).toBeLessThan(1_400);
  });
});
