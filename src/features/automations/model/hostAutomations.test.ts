import { expect, it } from "vitest";
import { parseHostAutomation } from "./hostAutomations";
import { AutomationSavePayloadSchema } from "../../../shared/model/host-contracts/automations";
import { quickAutomationActionSchema } from "../../../shared/model/host-contracts/assistant-quick-automation";

const input = {
  id: "automation",
  projectId: "project",
  name: "Audit",
  prompt: "Audit",
  harness: "codex",
  model: "codex:model",
  modelSettings: {},
  runtimeMode: "auto",
  scheduleKind: "daily",
  time: "09:00",
  minute: 0,
  dayOfWeek: 1,
};
it("keeps legacy rows fixed and round-trips every routing choice and account", () => {
  expect(parseHostAutomation(input).modelChoice).toBeUndefined();
  for (const modelChoice of [
    { kind: "default" },
    { kind: "order" },
    { kind: "pool", poolId: "pool" },
    { kind: "fixed" },
  ]) {
    const value = { ...input, modelChoice, providerAccountId: "account" };
    expect(parseHostAutomation(value)).toMatchObject({ modelChoice, providerAccountId: "account" });
    expect(AutomationSavePayloadSchema.parse(value)).toMatchObject({
      modelChoice,
      providerAccountId: "account",
    });
  }
});
it.each([{ kind: "unknown" }, { kind: "pool" }, { kind: "fixed", target: {} }])(
  "rejects malformed choices %j",
  (modelChoice) => {
    expect(() => parseHostAutomation({ ...input, modelChoice })).toThrow();
  },
);
it.each(["", 1, "a".repeat(201)])("rejects malformed accounts %j", (providerAccountId) => {
  expect(() => parseHostAutomation({ ...input, providerAccountId })).toThrow();
});
it("accepts an empty voice model and routed quick automation fields", () => {
  const value = {
    ...input,
    kind: "automation",
    model: "",
    modelChoice: { kind: "default" },
    providerAccountId: "account",
    maxRunMinutes: 0,
    maxRunsPerDay: 0,
    isolate: false,
    enabled: true,
  };
  const { id: _, ...action } = value;
  expect(quickAutomationActionSchema.parse(action)).toMatchObject({
    modelChoice: { kind: "default" },
    providerAccountId: "account",
  });
});
