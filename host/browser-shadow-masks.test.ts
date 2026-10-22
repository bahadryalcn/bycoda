import { expect, it } from "vitest";
import { browserShadowMasks } from "./browser-shadow-masks";
it("finds closed shadow hosts by structural path and ignores native control internals", () => {
  expect(
    browserShadowMasks({
      nodeType: 9,
      children: [
        {
          nodeType: 1,
          localName: "html",
          children: [
            {
              nodeType: 1,
              localName: "body",
              children: [
                { nodeType: 1, localName: "div" },
                { nodeType: 1, localName: "div", shadowRoots: [{ shadowRootType: "closed" }] },
                {
                  nodeType: 1,
                  localName: "input",
                  shadowRoots: [{ shadowRootType: "user-agent" }],
                },
              ],
            },
          ],
        },
      ],
    }),
  ).toEqual(["html:nth-of-type(1) > body:nth-of-type(1) > div:nth-of-type(2)"]);
});
it("fails closed if shadow masks exceed their redaction budget", () => {
  expect(() =>
    browserShadowMasks({
      nodeType: 9,
      children: Array.from({ length: 513 }, () => ({
        nodeType: 1,
        localName: "div",
        shadowRoots: [{ shadowRootType: "closed" }],
      })),
    }),
  ).toThrow("budget");
});
