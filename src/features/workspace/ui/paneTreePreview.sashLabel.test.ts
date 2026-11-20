import { describe, expect, it } from "vitest";
import type { LayoutSash } from "../model/layout";
import { paneSashLabel } from "./paneTreePreview";

const sash = (dir: LayoutSash["dir"], index: number, sizes: number[]): LayoutSash => ({
  splitId: "split",
  index,
  dir,
  group: { x: 0, y: 0, w: 1, h: 1 },
  sizes,
});

// Records the key and slot values so the test asserts what the label says, not how it was translated.
const record = (message: string, values?: Record<string, unknown>) =>
  `${message} ${JSON.stringify(values)}`;

describe("paneSashLabel", () => {
  it("names the two neighbouring columns and the split size for a column sash", () => {
    expect(paneSashLabel(sash("right", 0, [0.3, 0.7]), record)).toBe(
      'Resize between column {p0} and column {p1} of {p2} {"p0":1,"p1":2,"p2":2}',
    );
  });

  it("names the two neighbouring rows for a row sash", () => {
    expect(paneSashLabel(sash("down", 1, [0.2, 0.3, 0.5]), record)).toBe(
      'Resize between row {p0} and row {p1} of {p2} {"p0":2,"p1":3,"p2":3}',
    );
  });

  it("gives each divider of a three-pane split a different name", () => {
    const sizes = [0.2, 0.3, 0.5];
    const first = paneSashLabel(sash("right", 0, sizes), record);
    const second = paneSashLabel(sash("right", 1, sizes), record);
    expect(first).not.toBe(second);
  });
});
