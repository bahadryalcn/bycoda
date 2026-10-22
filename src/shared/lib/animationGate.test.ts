import { describe, expect, it } from "vitest";
import { createFloatBuffer, shouldRunLoop } from "./animationGate";

const base = { documentHidden: false, visible: true, sized: true };

describe("shouldRunLoop", () => {
  it("runs when visible, sized and the document is shown", () => {
    expect(shouldRunLoop(base)).toBe(true);
    expect(shouldRunLoop({ ...base, enabled: true })).toBe(true);
  });

  it("stops for each blocking condition", () => {
    expect(shouldRunLoop({ ...base, enabled: false })).toBe(false);
    expect(shouldRunLoop({ ...base, documentHidden: true })).toBe(false);
    expect(shouldRunLoop({ ...base, visible: false })).toBe(false);
    expect(shouldRunLoop({ ...base, sized: false })).toBe(false);
    expect(shouldRunLoop({ ...base, reducedMotion: true })).toBe(false);
  });
});

describe("createFloatBuffer", () => {
  it("reuses the same buffer for an unchanged length and clears it", () => {
    const get = createFloatBuffer();
    const first = get(12);
    first[3] = 0.5;
    const second = get(12);
    expect(second).toBe(first);
    expect(Array.from(second).every((value) => value === 0)).toBe(true);
  });

  it("reallocates only when the length changes", () => {
    const get = createFloatBuffer();
    const small = get(4);
    const large = get(9);
    expect(large).not.toBe(small);
    expect(large.length).toBe(9);
    expect(get(9)).toBe(large);
  });
});
