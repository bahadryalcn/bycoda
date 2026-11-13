import { expect, it } from "vitest";
import { assistantAccessMode, assistantAccessPatch } from "./assistantAccess";

const execution = {
  harness: "codex",
  model: "gpt-6",
  runtimeMode: "supervised",
  modelSettings: {},
  maxRunMinutes: 60,
} as const;
it("does not call mixed or unloaded grants full access", () => {
  const profile = assistantAccessPatch({ execution }, "full");
  expect(assistantAccessMode(profile, undefined, true)).toBe("loading");
  expect(
    assistantAccessMode(
      profile,
      { enabled: true, permissionMode: "full", allowPhysicalInput: false },
      true,
    ),
  ).toBe("custom");
  expect(
    assistantAccessMode(
      profile,
      { enabled: true, permissionMode: "full", allowPhysicalInput: true },
      false,
    ),
  ).toBe("custom");
  expect(
    assistantAccessMode(
      profile,
      { enabled: true, permissionMode: "full", allowPhysicalInput: true },
      true,
    ),
  ).toBe("custom");
  expect(
    assistantAccessMode(
      profile,
      { enabled: true, permissionMode: "full", allowPhysicalInput: true },
      true,
      true,
    ),
  ).toBe("full");
});
it("full access removes job confirmations without changing the model", () => {
  expect(assistantAccessPatch({ execution }, "full")).toMatchObject({
    execution: { ...execution, runtimeMode: "full-access" },
    confirmJobs: false,
    planApproval: "never",
  });
  expect(assistantAccessPatch({}, "full")).not.toHaveProperty("execution");
});
it("supervised access restores confirmation", () => {
  const profile = assistantAccessPatch({ execution }, "ask");
  expect(profile).toMatchObject({ confirmJobs: true, execution: { runtimeMode: "supervised" } });
  expect(
    assistantAccessMode(
      profile,
      { enabled: true, permissionMode: "ask", allowPhysicalInput: true },
      false,
    ),
  ).toBe("ask");
});
