import { expect, it } from "vitest";
import { redactCrewProfiles } from "./crew-task-view";
import { createDefaultCrew } from "../../src/features/crews/model/crewDefaults";

it("redacts instructions without changing saved profiles or view identity", () => {
  const defaults = createDefaultCrew(
    { models: { codex: [{ id: "codex:fixture", harness: "codex", name: "Fixture" }] }, errors: {} },
    1,
  )!;
  const definition = defaults.definition;
  const agent = { ...definition.agents[0]!, updatedAt: 1, projectId: "project" };
  const view = { definitions: [definition], agents: [agent], marker: "retained" };
  const redacted = redactCrewProfiles(view);
  expect(redacted.marker).toBe("retained");
  expect(redacted.agents[0]).toEqual({ ...agent, instructions: "" });
  expect(redacted.definitions[0]!.agents.every((member) => member.instructions === "")).toBe(true);
  expect(agent.instructions).not.toBe("");
  expect(definition.agents[0]!.instructions).not.toBe("");
});
