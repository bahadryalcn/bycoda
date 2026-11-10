import { describe, expect, it } from "vitest";
import { parseCrewAgent } from "./crew";
import {
  crewToolExtras,
  crewToolPreset,
  crewToolProfileChoice,
  crewToolProfileFor,
  parseCrewTools,
} from "./crewTools";

const member = (tools?: unknown) => ({
  id: "a",
  name: "A",
  role: "specialist",
  instructions: "",
  selection: "fixed",
  candidates: [{ id: "c", harness: "codex", model: "m", modelSettings: {}, capabilities: {} }],
  ...(tools === undefined ? {} : { tools }),
});

describe("parseCrewTools", () => {
  it("keeps a preset and trims and dedupes lists", () => {
    expect(
      parseCrewTools({
        preset: "custom",
        conversationTools: ["files.read", " files.read ", "browser.*", "browser"],
        mcpServers: ["github"],
        skills: [],
      }),
    ).toEqual({
      preset: "custom",
      conversationTools: ["files.read", "browser.*", "browser"],
      mcpServers: ["github"],
    });
  });

  it("combines extras with a non-writing preset and drops them elsewhere", () => {
    expect(
      parseCrewTools({ preset: "read-only", extras: ["browser", "design", "browser"] }),
    ).toEqual({
      preset: "read-only",
      extras: ["browser", "design"],
    });
    expect(parseCrewTools({ preset: "design", extras: ["browser"] })).toEqual({
      preset: "design",
      extras: ["browser"],
    });
    expect(parseCrewTools({ preset: "read-only", extras: [] })).toEqual({ preset: "read-only" });
    expect(parseCrewTools({ preset: "code", extras: ["design"] })).toBeUndefined();
    expect(crewToolExtras({ preset: "design", extras: ["browser"] })).toEqual([
      "design",
      "browser",
    ]);
    expect(() => parseCrewTools({ preset: "read-only", extras: ["code"] })).toThrow();
  });

  it("treats plain code as no profile", () => {
    expect(parseCrewTools({ preset: "code" })).toBeUndefined();
    expect(parseCrewTools({ preset: "code", conversationTools: ["files.read"] })).toEqual({
      preset: "code",
      conversationTools: ["files.read"],
    });
    expect(crewToolPreset(undefined)).toBe("code");
  });

  it.each([
    null,
    [],
    { preset: "root" },
    { preset: "custom", extra: 1 },
    { preset: "custom", conversationTools: ["files read"] },
    { preset: "custom", conversationTools: ["*"] },
    { preset: "custom", conversationTools: "files.read" },
    { preset: "custom", skills: [""] },
    { preset: "custom", conversationTools: Array.from({ length: 121 }, (_, i) => `a${i}`) },
  ])("rejects %j", (value) => {
    expect(() => parseCrewTools(value)).toThrow("Invalid member tool");
  });

  it("is part of a parsed member only when set", () => {
    expect(parseCrewAgent(member()).tools).toBeUndefined();
    expect(parseCrewAgent(member({ preset: "read-only" })).tools).toEqual({ preset: "read-only" });
    expect(() => parseCrewAgent(member({ preset: "x" }))).toThrow();
  });
});

describe("ready-made profiles", () => {
  it("round-trips every ready-made profile and reads no profile as full access", () => {
    expect(crewToolProfileChoice(undefined)).toBe("full");
    expect(crewToolProfileFor("full", { preset: "custom" })).toBeUndefined();
    for (const choice of ["developer", "designer", "tester"] as const) {
      const saved = parseCrewTools(crewToolProfileFor(choice, undefined));
      expect(crewToolProfileChoice(saved)).toBe(choice);
    }
  });

  it("treats edited lists, MCP or skill limits and older read-only profiles as custom", () => {
    const developer = crewToolProfileFor("developer", undefined)!;
    expect(crewToolProfileChoice({ ...developer, conversationTools: ["files", "git"] })).toBe(
      "custom",
    );
    expect(crewToolProfileChoice({ ...developer, skills: ["review"] })).toBe("custom");
    expect(crewToolProfileChoice({ preset: "read-only" })).toBe("custom");
  });

  it("custom keeps the current lists and switches an older read-only profile to writing", () => {
    const developer = crewToolProfileFor("developer", undefined)!;
    expect(crewToolProfileFor("custom", developer)).toBe(developer);
    expect(crewToolProfileFor("custom", { preset: "read-only", skills: ["a"] })).toEqual({
      preset: "custom",
      skills: ["a"],
    });
  });
});
