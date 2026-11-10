import { describe, expect, it } from "vitest";
import { parseCrewAgent } from "./crew";
import { crewToolPreset, parseCrewTools } from "./crewTools";

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
