import { describe, expect, it } from "vitest";
import { COMPOSER_MAX_HEIGHT, resizeComposer } from "./composerResize";

function field(scrollHeight: number, height = "") {
  return { style: { height }, scrollHeight };
}

describe("resizeComposer", () => {
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
