import { describe, expect, it } from "vitest";
import { motionAttributes } from "./Motion";

describe("motionAttributes", () => {
  it("preserves default attributes and merges placement classes", () => {
    expect(motionAttributes({}, "placement")).toMatchObject({
      "data-transition": "transform",
      "data-duration": undefined,
      "data-enter": undefined,
      className: expect.stringContaining("placement"),
    });
  });
  it("passes roles to the existing element", () => {
    expect(
      motionAttributes({ transition: "size", duration: "slow", easing: "exit", enter: "left" }),
    ).toMatchObject({
      "data-transition": "size",
      "data-duration": "slow",
      "data-easing": "exit",
      "data-enter": "left",
    });
  });
});
