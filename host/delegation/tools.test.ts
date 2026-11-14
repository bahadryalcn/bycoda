import { describe, expect, it } from "vitest";
import { AGENT_TOOL_SCHEMAS, describeAgentTool } from "./tools";

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

  it("tells the parent when to use it, in one short sentence", () => {
    expect(describeAgentTool("agents.delegate")).toContain("files:false");
  });
});
