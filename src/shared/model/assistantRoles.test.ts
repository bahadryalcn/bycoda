import { expect, it } from "vitest";
import { assistantRoleExecution, assistantRoleProfile } from "./assistantRoles";
import type { AssistantExecution, AssistantProfile } from "./host-contracts/assistant";
const worker: AssistantExecution = {
  harness: "codex",
  model: "saved-worker",
  modelSettings: { effort: "high", custom: "preserve" },
  runtimeMode: "full-access",
  maxRunMinutes: 60,
};
const chief: AssistantExecution = {
  harness: "claude",
  model: "saved-chief",
  modelSettings: { effort: "low" },
  runtimeMode: "auto",
  maxRunMinutes: 12,
};
it("inherits old omitted and explicit null role selections without inventing a model", () => {
  for (const role of ["chief", "reply", "planning"] as const) {
    expect(assistantRoleExecution({ execution: worker }, role)).toEqual(worker);
    expect(
      assistantRoleExecution(
        { execution: worker, chiefExecution: null, replyExecution: null, planningExecution: null },
        role,
      ),
    ).toEqual(worker);
    expect(assistantRoleExecution({}, role)).toBeNull();
  }
});
it("isolates each explicit role and its settings from worker and sibling mutations", () => {
  const profile = {
    execution: worker,
    chiefExecution: chief,
    replyExecution: { ...chief, model: "saved-reply" },
    planningExecution: { ...chief, model: "saved-planner" },
  };
  const selected = assistantRoleExecution(profile, "chief")!;
  selected.modelSettings.effort = "changed";
  expect(chief.modelSettings.effort).toBe("low");
  expect(worker.modelSettings.effort).toBe("high");
  expect(assistantRoleExecution(profile, "reply")?.model).toBe("saved-reply");
  expect(assistantRoleExecution(profile, "planning")?.model).toBe("saved-planner");
});
it("keeps explicit role provider/model while worker changes, and inherits only after explicit reset", () => {
  const changed = {
    execution: { ...worker, harness: "claude" as const, model: "new-worker" },
    chiefExecution: chief,
  };
  expect(assistantRoleExecution(changed, "chief")).toEqual(chief);
  expect(assistantRoleExecution(changed, "reply")?.model).toBe("new-worker");
  expect(assistantRoleExecution({ ...changed, chiefExecution: null }, "chief")?.model).toBe(
    "new-worker",
  );
});
it("projects the actual utility execution without rewriting the persisted profile", () => {
  const profile = {
    name: "Owner assistant",
    execution: worker,
    chiefExecution: chief,
  } as AssistantProfile;
  expect(assistantRoleProfile(profile, "chief")).toMatchObject({
    name: profile.name,
    execution: chief,
    chiefExecution: chief,
  });
  expect(profile.execution).toEqual(worker);
  expect(assistantRoleProfile(profile, "reply").execution).toEqual(worker);
});
