import { describe, expect, it } from "vitest";
import { CLAUDE_WORKSPACE_GLOB } from "../../../../shared/model/sessionApprovalGrant";
import { claudeSessionApprovalScope, parseControlRequest } from "./claudeProtocol";

const permission = {
  subtype: "can_use_tool",
  tool_name: "Glob",
  tool_use_id: "tool-1",
  input: { pattern: "**/*.ts" },
};

function scope(fields: Record<string, unknown> = {}, topLevelTool?: string) {
  const control = parseControlRequest({
    type: "control_request",
    request_id: "permission-1",
    request: { ...permission, ...fields },
  });
  return claudeSessionApprovalScope(control!, topLevelTool);
}

describe("Claude session approval classification", () => {
  it("requires an exact verified top-level tool and a cwd-relative filename search", () => {
    expect(scope({}, "Glob")).toBe(CLAUDE_WORKSPACE_GLOB);
    expect(scope({ input: { path: ".", pattern: "src/**/*.ts" } }, "Glob")).toBe(
      CLAUDE_WORKSPACE_GLOB,
    );
    expect(scope()).toBeUndefined();
    expect(scope({}, "Read")).toBeUndefined();
  });

  it.each([
    { subtype: "permission" },
    { tool_name: "mcp__filesystem__Glob" },
    { tool_name: "Read", input: { file_path: ".env" } },
    { tool_name: "Bash", input: { command: "rm demo.txt" } },
    { tool_name: "Write", input: { file_path: "demo.txt", content: "" } },
    { agent_id: "child-agent" },
    { parent_tool_use_id: "another-session-agent" },
    { blocked_path: "/outside" },
    { input: { path: "..", pattern: "**/*" } },
    { input: { path: "C:/secret", pattern: "*" } },
    { input: { pattern: "../*.ts" } },
    { input: { pattern: "**/.env" } },
    { input: { pattern: "**/*\n" } },
    { input: { pattern: "/etc/*" } },
    { input: { pattern: "-flag" } },
    { input: { pattern: "text", other: "unknown parameter" } },
  ])("keeps %j on the ordinary approval path", (fields) => {
    expect(scope(fields, "Glob")).toBeUndefined();
  });
});
