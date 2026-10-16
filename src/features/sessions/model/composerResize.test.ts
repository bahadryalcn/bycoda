import { describe, expect, it } from "vitest";
import { COMPOSER_MAX_HEIGHT, resizeComposer } from "./composerResize";

function field(scrollHeight: number, height = "") {
  return { style: { height }, scrollHeight };
}

describe("resizeComposer", () => {
  it("keeps a capped append stable but remeasures deletion and width changes", () => {
    let reads = 0;
    const el = {
      style: { height: "" },
      value: "large draft",
      clientWidth: 500,
      get scrollHeight() {
        reads++;
        return 400;
      },
    };
    resizeComposer(el);
    reads = 0;
    el.value += " appended";
    resizeComposer(el);
    expect(reads).toBe(0);
    el.value = "short";
    resizeComposer(el);
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    el.value += " appended";
    el.clientWidth = 700;
    resizeComposer(el);
    expect(reads).toBeGreaterThan(0);
  });
  it("holds occupied space during auto measurement and restores the wrapper", () => {
    const wrapper = { style: { minHeight: "20px" }, offsetHeight: 180 };
    const style = { height: "160px" };
    let measuring = false;
    const el = {
      style,
      parentElement: wrapper,
      get scrollHeight() {
        if (style.height === "auto") {
          measuring = true;
          expect(wrapper.style.minHeight).toBe("180px");
        }
        return 72;
      },
    };
    resizeComposer(el);
    expect(measuring).toBe(true);
    expect(style.height).toBe("72px");
    expect(wrapper.style.minHeight).toBe("20px");
  });
  it("grows the field to fit the draft", () => {
    const el = field(88);
    resizeComposer(el);
    expect(el.style.height).toBe("88px");
  });

  it("stops growing at the max height", () => {
    const el = field(400);
    resizeComposer(el);
    expect(el.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
  });

  it("supports a taller field without changing the composer default", () => {
    const el = field(400);
    resizeComposer(el, Number.POSITIVE_INFINITY);
    expect(el.style.height).toBe("400px");
  });

  it("leaves the height alone when the field has no layout box", () => {
    const el = field(0, "88px");
    resizeComposer(el);
    expect(el.style.height).toBe("88px");
  });
});
