import { describe, expect, it } from "vitest";
import { consumeWorkCommand, WORK_COMMANDS } from "./workCommands";

describe("Work commands", () => {
  it("keeps provider goals and ordinary slash text unchanged", () => {
    for (const value of ["/goal build this", "Discuss /epic", "/epics list"])
      expect(consumeWorkCommand(value)).toBeNull();
    expect(WORK_COMMANDS.map((item) => item.name)).toEqual(["epic", "crew", "automation"]);
  });
  it("creates an Epic through the existing approved planner", () => {
    expect(consumeWorkCommand("/EPIC build a report")?.prompt).toContain("goals.create");
    expect(consumeWorkCommand("/epic ")).toMatchObject({ request: "", prompt: "" });
  });
  it("retains exact quoted Crew identity and request text", () => {
    const command = consumeWorkCommand('/crew:"Mobile team" Fix the layout');
    expect(command).toMatchObject({ name: "crew", request: "Fix the layout" });
    expect(command?.prompt).toContain('"Mobile team"');
    expect(command?.prompt).toContain("task-linked");
    expect(consumeWorkCommand("/crew:Review audit")?.prompt).toContain('"Review"');
    expect(consumeWorkCommand("/crew:")).toMatchObject({ name: "crew", request: "", prompt: "" });
  });
  it("leaves automation creation to the typed owner confirmation, never a delegated prompt", () => {
    const command = consumeWorkCommand("/automation every day at 11 send the weather");
    expect(command).toMatchObject({
      name: "automation",
      request: "every day at 11 send the weather",
      prompt: "",
    });
  });
});
