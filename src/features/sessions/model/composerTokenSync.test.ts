import { describe, expect, it } from "vitest";
import { tokenSyncUnchanged, type TokenSyncSnapshot } from "./composerTokenSync";

const skills: unknown[] = [];
const base: TokenSyncSnapshot = { value: "/pl", cursor: 3, context: [skills, "codex"] };

describe("tokenSyncUnchanged", () => {
  it("parses the first time", () => {
    expect(tokenSyncUnchanged(null, base)).toBe(false);
  });

  it("skips the select and keyup that follow an input with the same text and caret", () => {
    expect(tokenSyncUnchanged(base, { ...base })).toBe(true);
  });

  it("parses again when the text or the caret moved", () => {
    expect(tokenSyncUnchanged(base, { ...base, value: "/pla", cursor: 4 })).toBe(false);
    expect(tokenSyncUnchanged(base, { ...base, cursor: 1 })).toBe(false);
  });

  it("parses again when the skill list or harness changed under the same text", () => {
    expect(tokenSyncUnchanged(base, { ...base, context: [[], "codex"] })).toBe(false);
    expect(tokenSyncUnchanged(base, { ...base, context: [skills, "claude"] })).toBe(false);
  });
});
