import { describe, expect, it } from "vitest";
import { isImeComposition } from "./keyboard";

function keyEvent(
  overrides: Partial<Pick<KeyboardEvent, "isComposing" | "keyCode">> = {},
): Pick<KeyboardEvent, "isComposing" | "keyCode"> {
  return {
    isComposing: false,
    keyCode: 13,
    ...overrides,
  };
}

describe("isImeComposition", () => {
  it("accepts chord-only inputs while checking any available composition metadata", () => {
    expect(isImeComposition({})).toBe(false);
    expect(isImeComposition({ isComposing: true })).toBe(true);
    expect(isImeComposition({ keyCode: 229 })).toBe(true);
  });
  it("detects an active IME composition", () => {
    expect(isImeComposition(keyEvent({ isComposing: true }))).toBe(true);
  });

  it("detects the legacy IME key code used by WebKit", () => {
    expect(isImeComposition(keyEvent({ keyCode: 229 }))).toBe(true);
  });

  it("leaves ordinary keyboard events alone", () => {
    expect(isImeComposition(keyEvent())).toBe(false);
  });
});
