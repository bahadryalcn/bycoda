import { describe, expect, it } from "vitest";
import { AGENT_TOOL_SCHEMAS, agentToolAllowed, describeAgentTool } from "./tools";

describe("files: false schema", () => {
  it("is an optional boolean on delegate and consult, nowhere else", () => {
    for (const action of ["agents.delegate", "agents.consult"] as const) {
      const schema = AGENT_TOOL_SCHEMAS[action];
      expect(schema.properties.files).toMatchObject({ type: "boolean" });
      expect(schema.required).not.toContain("files");
      expect(schema.additionalProperties).toBe(false);
    }
    expect(AGENT_TOOL_SCHEMAS["agents.reply"].properties).not.toHaveProperty("files");
  });

  it("directs the parent to use normal project access by default", () => {
    const description = describeAgentTool("agents.delegate");
    expect(description).toContain("Omit files or set files:true for normal project access");
    expect(description).toContain("When tools are unnecessary or unavailable");
    expect(description).toContain("files:false only when the owner explicitly asks");
  });
});

it("offers a subagent its own runs but no advisor, and a leaf only its group", () => {
  for (const action of ["agents.delegate", "agents.consult", "agents.wait", "agents.list"])
    expect(agentToolAllowed(action, "owner"), action).toBe(true);
  expect(agentToolAllowed("agents.delegate", "subagent")).toBe(true);
  expect(agentToolAllowed("agents.wait", "subagent")).toBe(true);
  expect(agentToolAllowed("agents.consult", "subagent")).toBe(false);
  for (const action of ["agents.delegate", "agents.consult", "agents.wait", "agents.options"])
    expect(agentToolAllowed(action, "leaf"), action).toBe(false);
  expect(agentToolAllowed("agents.send", "leaf")).toBe(true);
  expect(agentToolAllowed("files.read", "leaf")).toBe(true);
});
