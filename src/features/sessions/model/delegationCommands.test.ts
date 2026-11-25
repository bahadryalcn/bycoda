import { describe, expect, it } from "vitest";
import { consumeDelegationCommand } from "./delegationCommands";

describe("consumeDelegationCommand", () => {
  it("ignores prompts without a leading delegation command", () => {
    expect(consumeDelegationCommand("fix /task parsing")).toBeNull();
    expect(consumeDelegationCommand("/tasks list")).toBeNull();
  });

  it("asks for explicit parallel subagents and keeps the request first", () => {
    const command = consumeDelegationCommand("/subagents 4 audit the host\nand the app");
    expect(command?.name).toBe("subagents");
    expect(command?.request).toBe("audit the host\nand the app");
    expect(command?.prompt.startsWith("audit the host\nand the app\n\n")).toBe(true);
    expect(command?.prompt).toContain(
      "this session offers (built-in or agents.delegate), using up to 4 at once.",
    );
  });

  it("caps the subagent count and treats a missing count as unbounded", () => {
    expect(consumeDelegationCommand("/subagents 99 go")?.prompt).toContain("up to 16 at once");
    expect(consumeDelegationCommand("/subagents go")?.prompt).not.toContain("up to");
  });

  it("hands /task the owner's words unchanged and gives the model no prompt to rewrite them", () => {
    expect(consumeDelegationCommand("/TASK Fix the login button label.\nIt says Sing in.")).toEqual(
      {
        name: "task",
        request: "Fix the login button label.\nIt says Sing in.",
        prompt: "",
      },
    );
  });

  it("reports an empty request so the caller can keep the draft", () => {
    expect(consumeDelegationCommand("/task   ")).toMatchObject({ request: "", prompt: "" });
    expect(consumeDelegationCommand("/subagents 3")).toMatchObject({ request: "", prompt: "" });
  });
});
