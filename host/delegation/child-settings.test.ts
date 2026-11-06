import { describe, expect, it } from "vitest";
import type { AgentModel } from "../../src/features/sessions/model/models";
import { childModelSettings, parentEffort } from "./child-settings";

const levels = (id: string, values: string[], value: string): AgentModel["settings"] => [
  {
    id,
    label: "Reasoning",
    kind: "select",
    value,
    options: values.map((v) => ({ value: v, label: v })),
  },
];
const model = (settings: AgentModel["settings"]): AgentModel => ({
  id: "claude:haiku",
  harness: "claude",
  name: "Haiku",
  settings,
});

describe("childModelSettings", () => {
  it("uses the parent's level when the child offers it", () => {
    const child = model(levels("effort", ["low", "medium", "high"], "high"));
    expect(childModelSettings(child, { reasoningEffort: "low" })).toEqual({ effort: "low" });
  });

  it("falls back to the closest level the child offers", () => {
    const child = model(levels("variant", ["high", "max"], "max"));
    expect(childModelSettings(child, { effort: "low" })).toEqual({ variant: "high" });
  });

  it("keeps the child's defaults without a parent level or child effort setting", () => {
    const child = model(levels("effort", ["low", "high"], "high"));
    expect(childModelSettings(child, { serviceTier: "default" })).toEqual({ effort: "high" });
    expect(childModelSettings(model(undefined), { effort: "low" })).toEqual({});
  });

  it("never copies reserved delegation keys", () => {
    const child = model(levels("effort", ["low"], "low"));
    expect(
      childModelSettings(child, { effort: "low", crossSubagents: "[]", delegationParent: "{}" }),
    ).toEqual({ effort: "low" });
  });

  it("reads the parent level from any provider's effort key", () => {
    expect(parentEffort({ variant: "minimal" })).toBe("minimal");
    expect(parentEffort({ fast: "true" })).toBeUndefined();
  });
});
