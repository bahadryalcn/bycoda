import { describe, expect, it } from "vitest";
import {
  evaluateTaskPreflight,
  parseTaskPreflightRequirements,
  taskPreflightResourceKey,
  type TaskPreflightFacts,
  type TaskPreflightObservation,
} from "./taskPreflight";

const now = 10_000;
const checked = (state: TaskPreflightObservation["state"] = "ready"): TaskPreflightObservation => ({
  state,
  origin: "runtime",
  checkedAt: now,
});
const facts = (): TaskPreflightFacts => ({
  host: checked(),
  project: checked(),
  provider: checked(),
  model: checked(),
});
const requirement = { kind: "connection" as const, id: "documents" };

describe("task preparation observations", () => {
  it("requires positive recent runtime observations, including required resources", () => {
    const current = facts();
    current.resources = { [taskPreflightResourceKey(requirement)]: checked() };
    expect(evaluateTaskPreflight([requirement], current, now).state).toBe("ready");
    expect(evaluateTaskPreflight([requirement], facts(), now).state).toBe("unknown");
    expect(evaluateTaskPreflight([], {}, now).items.every((item) => item.state === "unknown")).toBe(
      true,
    );
  });

  it("does not treat installed inventory, stale results, future results or missing timestamps as connected", () => {
    for (const entry of [
      { state: "ready", origin: "inventory", checkedAt: now },
      { state: "ready", origin: "configuration", checkedAt: now },
      { state: "ready", origin: "runtime", checkedAt: now - 500_000 },
      { state: "ready", origin: "runtime", checkedAt: now + 1 },
      { state: "ready", origin: "runtime" },
    ] satisfies TaskPreflightObservation[]) {
      expect(
        evaluateTaskPreflight(
          [requirement],
          { ...facts(), resources: { [taskPreflightResourceKey(requirement)]: entry } },
          now,
        ).state,
      ).toBe("unknown");
    }
  });

  it("blocks disabled requirements and preserves optional warnings without silently enabling them", () => {
    const current = {
      ...facts(),
      resources: { [taskPreflightResourceKey(requirement)]: checked("disabled") },
    };
    expect(evaluateTaskPreflight([requirement], current, now).state).toBe("blocked");
    const optional = evaluateTaskPreflight([{ ...requirement, required: false }], current, now);
    expect(optional.state).toBe("ready");
    expect(optional.items.at(-1)).toMatchObject({ state: "blocked", required: false });
    expect(current.resources[taskPreflightResourceKey(requirement)].state).toBe("disabled");
  });

  it("rejects duplicates, credentials and unknown action properties", () => {
    expect(() => parseTaskPreflightRequirements([requirement, requirement])).toThrow();
    expect(() => parseTaskPreflightRequirements([{ ...requirement, allowSend: true }])).toThrow();
    expect(() =>
      parseTaskPreflightRequirements([
        { ...requirement, id: "https://example.test/?access_token=secret" },
      ]),
    ).toThrow();
    expect(() =>
      parseTaskPreflightRequirements([
        { ...requirement, id: "https://user:password@example.test" },
      ]),
    ).toThrow();
    expect(parseTaskPreflightRequirements(undefined)).toEqual([]);
  });
});
