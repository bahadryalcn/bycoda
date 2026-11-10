import { describe, expect, it } from "vitest";
import {
  defaultCrewPolicy,
  parseCrewDefinition,
  selectCrewCandidate,
  crewScopesOverlap,
  parseCrewScopes,
  type CrewAgent,
  type CrewCandidate,
} from "./crew";

const candidate = (id: string, cost?: number, quality?: number): CrewCandidate => ({
  id,
  harness: "codex",
  model: id,
  modelSettings: {},
  capabilities: {},
  cost,
  quality,
});
const agent = (
  candidates: CrewCandidate[],
  selection: CrewAgent["selection"] = "automatic",
): CrewAgent => ({
  id: "worker",
  name: "Worker",
  role: "specialist",
  instructions: "",
  candidates,
  selection,
});
describe("crew allocation", () => {
  it("normalizes file leases and blocks traversal and overlapping scopes", () => {
    expect(parseCrewScopes(["./src/./ui/", "src\\backend", "."])).toEqual([
      "src/ui",
      "src/backend",
      ".",
    ]);
    expect(() => parseCrewScopes(["../outside"])).toThrow();
    expect(crewScopesOverlap(["src/ui"], ["src/ui/Button.tsx"])).toBe(true);
    expect(crewScopesOverlap(["src/ui"], ["src/backend"])).toBe(false);
    expect(crewScopesOverlap(["."], ["src/backend"])).toBe(true);
  });
  it("filters missing capabilities before considering quality or cost", () => {
    const cheap = candidate("cheap", 0, 100);
    const image = {
      ...candidate("image", 5, 80),
      capabilities: {
        "image-generation": { state: "available" as const, observedAt: 1000, source: "probe" },
      },
    };
    expect(
      selectCrewCandidate(
        agent([cheap, image]),
        defaultCrewPolicy,
        ["image-generation"],
        () => true,
        1001,
      ).candidate.id,
    ).toBe("image");
    expect(() =>
      selectCrewCandidate(
        agent([image]),
        defaultCrewPolicy,
        ["image-generation"],
        () => true,
        1000 + 86400000,
      ),
    ).toThrow("No eligible");
    expect(() =>
      selectCrewCandidate(
        agent([image]),
        defaultCrewPolicy,
        ["image-generation"],
        () => false,
        1001,
      ),
    ).toThrow("No eligible");
  });
  it("does not escape a fixed model pin", () => {
    expect(() =>
      selectCrewCandidate(
        agent([candidate("fixed"), candidate("fallback")], "fixed"),
        defaultCrewPolicy,
        [],
        (c) => c.id === "fallback",
      ),
    ).toThrow("No eligible");
  });
  it("distinguishes unknown costs from zero and applies hard thresholds first", () => {
    const options = agent([
      candidate("unknown", undefined, 100),
      candidate("cheap", 1, 60),
      candidate("quality", 3, 95),
    ]);
    expect(
      selectCrewCandidate(
        options,
        { ...defaultCrewPolicy, preset: "economy", allowUnknownCost: false },
        [],
        () => true,
      ).candidate.id,
    ).toBe("cheap");
    expect(
      selectCrewCandidate(
        options,
        { ...defaultCrewPolicy, preset: "quality", maxEstimatedCost: 2 },
        [],
        () => true,
      ).candidate.id,
    ).toBe("cheap");
    expect(() =>
      selectCrewCandidate(
        options,
        { ...defaultCrewPolicy, minimumQuality: 90, maxEstimatedCost: 2 },
        [],
        () => true,
      ),
    ).toThrow();
  });
  it("rejects missing review roles and duplicate identities", () => {
    const worker = agent([candidate("one")]);
    const definition = {
      id: "crew",
      name: "Crew",
      updatedAt: 0,
      policy: defaultCrewPolicy,
      agents: [
        worker,
        { ...worker, id: "lead", role: "coordinator" },
        { ...worker, id: "reviewer", role: "reviewer" },
      ],
    };
    expect(parseCrewDefinition(definition).agents).toHaveLength(3);
    expect(() =>
      parseCrewDefinition({ ...definition, agents: [worker, worker, worker] }),
    ).toThrow();
    expect(() =>
      parseCrewDefinition({ ...definition, policy: { ...defaultCrewPolicy, maxParallel: 1.5 } }),
    ).toThrow();
  });
});

describe("crew access policy", () => {
  const base = { ...defaultCrewPolicy };
  const parse = (runtimeMode?: unknown) =>
    parseCrewDefinition({
      id: "c",
      name: "C",
      agents: (["coordinator", "specialist", "reviewer"] as const).map((role) => ({
        id: role,
        name: role,
        role,
        instructions: "",
        selection: "fixed",
        candidates: [
          { id: "x", harness: "codex", model: "m", modelSettings: {}, capabilities: {}, cost: 1 },
        ],
      })),
      policy: { ...base, ...(runtimeMode === undefined ? {} : { runtimeMode }) },
    });
  it("keeps a valid access mode", () => {
    expect(parse("full-access").policy.runtimeMode).toBe("full-access");
  });
  it("omits an absent access mode", () => {
    expect(parse().policy).not.toHaveProperty("runtimeMode");
  });
  it("rejects an unknown access mode", () => {
    expect(() => parse("root")).toThrow("Invalid crew access");
  });
});

describe("crew identity", () => {
  const member = (role: "coordinator" | "specialist" | "reviewer", extra = {}) => ({
    id: role,
    name: role,
    role,
    instructions: "",
    selection: "fixed",
    candidates: [
      { id: "x", harness: "codex", model: "m", modelSettings: {}, capabilities: {}, cost: 1 },
    ],
    ...extra,
  });
  const parse = (extra: Record<string, unknown> = {}, agentExtra: Record<string, unknown> = {}) =>
    parseCrewDefinition({
      id: "c",
      name: "C",
      agents: [member("coordinator", agentExtra), member("specialist"), member("reviewer")],
      policy: defaultCrewPolicy,
      ...extra,
    });
  it("keeps older data without identity fields", () => {
    const parsed = parse();
    expect(parsed).not.toHaveProperty("appearance");
    expect(parsed.agents[0]).not.toHaveProperty("avatar");
    expect(parsed.agents[0]).not.toHaveProperty("handle");
  });
  it("keeps a valid avatar and omits an empty one", () => {
    const avatar = { headwear: "beret", glasses: false, palette: 5, accessory: "pen" };
    expect(parse({}, { avatar }).agents[0]!.avatar).toEqual(avatar);
    expect(parse({}, { avatar: {} }).agents[0]).not.toHaveProperty("avatar");
  });
  it.each([
    { headwear: "crown" },
    { palette: 6 },
    { palette: 1.5 },
    { palette: -1 },
    { glasses: "yes" },
    { mood: "happy" },
  ])("rejects avatar %j", (avatar) => {
    expect(() => parse({}, { avatar })).toThrow("Invalid member avatar");
  });
  it("rejects a non-object avatar", () => {
    expect(() => parse({}, { avatar: [] })).toThrow("Invalid crew object");
  });
  it("normalizes handles and rejects invalid ones", () => {
    expect(parse({}, { handle: "  Pixel-Lead " }).agents[0]!.handle).toBe("pixel-lead");
    for (const handle of ["", "-a", "a-", "a b", "@a", "x".repeat(25), 4])
      expect(() => parse({}, { handle })).toThrow("Invalid member handle");
  });
  it("rejects a repeated handle inside one crew only", () => {
    const agents = [
      member("coordinator", { handle: "Same" }),
      member("specialist", { handle: "same" }),
      member("reviewer"),
    ];
    expect(() =>
      parseCrewDefinition({ id: "c", name: "C", agents, policy: defaultCrewPolicy }),
    ).toThrow("Duplicate member handles");
  });
  it("validates crew appearance and omits an empty one", () => {
    expect(parse({ appearance: { icon: "no-such-mascot", color: 1 } }).appearance).toEqual({
      color: 1,
    });
    expect(parse({ appearance: { color: 0 } })).not.toHaveProperty("appearance");
    expect(parse({ appearance: {} })).not.toHaveProperty("appearance");
    expect(() => parse({ appearance: [] })).toThrow();
  });
});
