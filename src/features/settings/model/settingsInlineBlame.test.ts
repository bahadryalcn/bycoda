import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INLINE_BLAME_DEFAULT, loadInlineBlame, saveInlineBlame } from "./settings";

const KEY = "bycoda.inlineBlame";

describe("inline blame setting", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("is off by default", () => {
    expect(INLINE_BLAME_DEFAULT).toBe(false);
    expect(loadInlineBlame()).toBe(false);
  });

  it("persists the choice", () => {
    saveInlineBlame(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(loadInlineBlame()).toBe(true);
    saveInlineBlame(false);
    expect(loadInlineBlame()).toBe(false);
  });
});
