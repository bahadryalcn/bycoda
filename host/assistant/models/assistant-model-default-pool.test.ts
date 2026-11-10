import { describe, expect, it } from "vitest";
import { modelValueClass, valueAwareAssistantPool } from "./assistant-model-default-pool";

const execution = (model: string, harness: "codex" | "claude" = "codex") => ({
  harness,
  model,
  modelSettings: {},
  runtimeMode: "auto" as const,
  maxRunMinutes: 60,
});
const same = (model: string) =>
  ({
    execution: execution(model),
    chiefExecution: execution(model),
    replyExecution: execution(model),
    planningExecution: execution(model),
  }) as never;
const effort = (value: string) => ({
  id: "effort",
  kind: "select",
  value,
  options: ["low", "medium", "high"].map((v) => ({ value: v })),
});
const m = (id: string, name: string) => ({ id, name, settings: [effort("medium")] });

describe("modelValueClass", () => {
  it("classes by name", () => {
    expect(modelValueClass(m("a", "GPT Mini"))).toBe(0);
    expect(modelValueClass(m("a", "Claude Opus 5"))).toBe(2);
    expect(modelValueClass(m("a", "Claude Haiku 4.5"))).toBe(0);
    expect(modelValueClass(m("a", "GPT-6.1"))).toBe(1);
  });
});

describe("valueAwareAssistantPool", () => {
  const catalog = {
    codex: [m("c:mini", "GPT-6 Mini"), m("c:std", "GPT-6.1"), m("c:pro", "GPT-6 Pro")],
  };
  it("splits three tiers with fallback order and effort per role", () => {
    const rows = valueAwareAssistantPool(same("c:std"), catalog)!;
    expect(rows.map((r) => [r.model, r.roles])).toEqual([
      ["c:pro", ["chief", "planning"]],
      ["c:std", ["worker", "chief", "planning"]],
      ["c:mini", ["reply", "worker"]],
    ]);
    expect(rows.map((r) => r.modelSettings.effort)).toEqual(["high", "medium", "low"]);
    expect(rows.map((r) => r.id)).toEqual(["derived-1", "derived-2", "derived-3"]);
  });
  it("two models: flagship carries worker/planning/chief, cheap one replies and backs up worker", () => {
    const rows = valueAwareAssistantPool(same("c:std"), {
      codex: [catalog.codex[0]!, catalog.codex[2]!],
    })!;
    expect(rows.map((r) => [r.model, r.roles])).toEqual([
      ["c:pro", ["worker", "planning", "chief"]],
      ["c:mini", ["reply", "worker"]],
    ]);
  });
  it("same class models keep every role on each, in catalog order", () => {
    const rows = valueAwareAssistantPool(same("a"), {
      codex: [m("a", "Alpha 1"), m("b", "Beta 1")],
    })!;
    expect(rows.map((r) => r.model)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.roles.length === 4)).toBe(true);
  });
  it("falls back to the mirror for one model, no catalog, or per-role models", () => {
    expect(valueAwareAssistantPool(same("c:std"), { codex: [catalog.codex[1]!] })).toBeUndefined();
    expect(valueAwareAssistantPool(same("c:std"), undefined)).toBeUndefined();
    const split = { ...(same("c:std") as object), replyExecution: execution("c:mini") } as never;
    expect(valueAwareAssistantPool(split, catalog)).toBeUndefined();
  });
  it("ignores harnesses the profile does not use", () => {
    expect(
      valueAwareAssistantPool(same("c:std"), {
        codex: [catalog.codex[1]!],
        claude: [m("x", "Opus")],
      }),
    ).toBeUndefined();
  });
});
