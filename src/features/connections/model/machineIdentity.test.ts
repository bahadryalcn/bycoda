import { describe, expect, it } from "vitest";
import { machineContext, machineLabel } from "./machineIdentity";

const base = { id: "a", name: "Build box", endpoint: "http://10.0.0.1:4000" };

describe("machine identity", () => {
  it("adds nothing while the name is unique", () => {
    const machines = [base, { id: "b", name: "Other", endpoint: "http://10.0.0.2:4000" }];
    expect(machineContext(machines, base)).toBe("");
    expect(machineLabel(machines, base)).toBe("Build box");
  });

  it("tells same-named machines apart by ssh target, then endpoint", () => {
    const twin = { id: "b", name: "Build box", endpoint: "http://x", ssh: { target: "dev@host" } };
    const machines = [base, twin];
    expect(machineLabel(machines, base)).toBe("Build box (http://10.0.0.1:4000)");
    expect(machineLabel(machines, twin as never)).toBe("Build box (dev@host)");
  });
});
