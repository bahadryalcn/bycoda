import { expect, it } from "vitest";
import { parseBrowserAnnotation } from "./browserAnnotation";

const rect = { x: 1, y: 2, width: 30, height: 40 };
const sample = () => ({
  id: "capture",
  projectId: "project",
  sessionId: "session",
  navigationId: "nav",
  capturedAt: "2026-11-04T00:00:00Z",
  pageUrl: "https://example.test/",
  devicePixelRatio: 1,
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
  trust: "untrusted-page-data",
  limitations: [],
  comment: "Inspect this",
  element: {
    tag: "button",
    text: "Save",
    selector: "button",
    path: "button",
    bounds: rect,
    center: { x: 16, y: 22 },
    ancestry: [],
    computedStyle: {},
    inspectionVersion: 1,
    role: "button",
    interaction: { disabled: false, focusable: true },
    layout: { display: "flex", childBounds: [rect] },
    boxModel: { content: rect, padding: rect, border: rect, margin: rect },
    boxModelLimitation: "Fixture limitation",
    nodeId: "ephemeral",
    parentNodeId: "ephemeral-parent",
  },
});
it("retains versioned bounded geometry and semantics but drops ephemeral node identity", () => {
  const parsed = parseBrowserAnnotation(sample());
  expect(parsed.element).toMatchObject({
    inspectionVersion: 1,
    role: "button",
    boxModel: sample().element.boxModel,
    interaction: { disabled: false, focusable: true },
    layout: { display: "flex", childBounds: [rect] },
    boxModelLimitation: "Fixture limitation",
  });
  expect(parsed.element).not.toHaveProperty("nodeId");
  expect(parsed.element).not.toHaveProperty("parentNodeId");
  expect(parseBrowserAnnotation(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
});
it("rejects invalid extension versions and unsafe geometry", () => {
  const badVersion = sample();
  badVersion.element.inspectionVersion = 2;
  expect(() => parseBrowserAnnotation(badVersion)).toThrow("version");
  const badRect = sample();
  badRect.element.boxModel.content = { ...rect, width: -1 };
  expect(() => parseBrowserAnnotation(badRect)).toThrow("geometry");
  const infinite = sample();
  infinite.element.boxModel.margin = { ...rect, x: Infinity };
  expect(() => parseBrowserAnnotation(infinite)).toThrow();
});
