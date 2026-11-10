import { expect, it } from "vitest";
import { memberOf } from "./crewMembership";
import type { CrewAgent } from "./crew";

const member = (id: string, source?: string): CrewAgent => ({
  id,
  name: id,
  role: "specialist",
  instructions: "",
  selection: "fixed",
  candidates: [],
  ...(source ? { source: { id: source, updatedAt: 1 } } : {}),
});

it("maps library profiles to the crews that link them, once per crew", () => {
  const map = memberOf([
    { id: "a", agents: [member("m1", "lib"), member("m2", "lib"), member("m3")] },
    { id: "b", agents: [member("m4", "lib"), member("m5", "other")] },
    { id: "c", agents: [member("m6")] },
  ]);
  expect(map.get("lib")).toEqual(["a", "b"]);
  expect(map.get("other")).toEqual(["b"]);
  expect(map.size).toBe(2);
});
