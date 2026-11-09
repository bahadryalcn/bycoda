// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { USER_PRESENCE_IDLE_MS, userPresent } from "./userPresence";
import { monotonicNow } from "./time/timestamps";

afterEach(() => vi.restoreAllMocks());

describe("userPresent", () => {
  it("needs focus and recent input", () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(userPresent()).toBe(false);
    focus.mockReturnValue(true);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    const at = monotonicNow();
    expect(userPresent(at)).toBe(true);
    expect(userPresent(at + USER_PRESENCE_IDLE_MS + 1_000)).toBe(false);
    focus.mockReturnValue(false);
    expect(userPresent(at)).toBe(false);
  });
});
