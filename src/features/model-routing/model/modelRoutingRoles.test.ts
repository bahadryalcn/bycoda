import { describe, expect, it } from "vitest";
import {
  MODEL_ROUTING_DELEGATION_KEYS,
  MODEL_ROUTING_ROLES,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";
import {
  effectiveRoleChoice,
  MODEL_ROLE_METADATA,
  modelChoicesEqual,
  pruneMissingPoolBindings,
  roleBindingsForSave,
  withoutDelegation,
} from "./modelRoutingRoles";

const target: ModelRoutingTarget = {
  harness: "codex",
  model: "gpt-5",
  modelSettings: { effort: "high", fast: "true" },
};

describe("model role choices", () => {
  it("covers every contract role once in contract order", () => {
    expect(MODEL_ROLE_METADATA.map((item) => item.role)).toEqual(MODEL_ROUTING_ROLES);
    expect(MODEL_ROLE_METADATA.every((item) => item.labelKey && item.descriptionKey)).toBe(true);
  });
  it("uses implicit main order for unbound roles", () => {
    expect(effectiveRoleChoice({}, "task.worker")).toEqual({ kind: "order" });
    expect(effectiveRoleChoice({ steward: { kind: "pool", poolId: "p" } }, "steward")).toEqual({
      kind: "pool",
      poolId: "p",
    });
    expect(modelChoicesEqual(undefined, { kind: "order" })).toBe(true);
    expect(modelChoicesEqual(undefined, { kind: "pool", poolId: "p" })).toBe(false);
  });
  it("compares pool identity and all fixed fields without depending on settings insertion order", () => {
    expect(modelChoicesEqual({ kind: "pool", poolId: "p" }, { kind: "pool", poolId: "q" })).toBe(
      false,
    );
    expect(modelChoicesEqual({ kind: "pool", poolId: "p" }, { kind: "pool", poolId: "p" })).toBe(
      true,
    );
    const fixed = { kind: "fixed" as const, target };
    expect(
      modelChoicesEqual(fixed, {
        kind: "fixed",
        target: { ...target, modelSettings: { fast: "true", effort: "high" } },
      }),
    ).toBe(true);
    for (const patch of [
      { model: "other" },
      { harness: "claude" as const },
      { providerAccountId: "other" },
      { modelSettings: { effort: "low" } },
    ]) {
      expect(modelChoicesEqual(fixed, { kind: "fixed", target: { ...target, ...patch } })).toBe(
        false,
      );
    }
  });
  it("prunes only missing pool bindings without mutating inputs", () => {
    const roles = {
      steward: { kind: "pool" as const, poolId: "gone" },
      automation: { kind: "pool" as const, poolId: "keep" },
      "task.worker": { kind: "fixed" as const, target },
    };
    expect(
      pruneMissingPoolBindings(roles, [{ id: "keep", name: "Keep", entryIds: ["e"] }]),
    ).toEqual({ automation: roles.automation, "task.worker": roles["task.worker"] });
    expect(roles.steward.poolId).toBe("gone");
  });
  it("omits main order and strips every delegation key from fixed settings", () => {
    const polluted = {
      ...target,
      modelSettings: {
        ...target.modelSettings,
        ...Object.fromEntries(MODEL_ROUTING_DELEGATION_KEYS.map((key) => [key, "reserved"])),
      },
    };
    expect(withoutDelegation(polluted)).toEqual(target);
    expect(
      roleBindingsForSave({
        steward: { kind: "order" },
        automation: { kind: "fixed", target: polluted },
      }),
    ).toEqual({ automation: { kind: "fixed", target } });
    expect(polluted.modelSettings.crossAdvisor).toBe("reserved");
  });
});

it("distinguishes automatic helpers from explicit main order and preserves that order on save", () => {
  expect(effectiveRoleChoice({}, "text.title")).toBeUndefined();
  expect(effectiveRoleChoice({ "text.title": { kind: "order" } }, "text.title")).toEqual({
    kind: "order",
  });
  expect(modelChoicesEqual(undefined, { kind: "order" }, "text.title")).toBe(false);
  expect(modelChoicesEqual(undefined, undefined, "text.title")).toBe(true);
  expect(
    roleBindingsForSave({ "text.title": { kind: "order" }, steward: { kind: "order" } }),
  ).toEqual({ "text.title": { kind: "order" } });
});
