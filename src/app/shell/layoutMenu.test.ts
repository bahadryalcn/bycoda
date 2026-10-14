import { describe, expect, it } from "vitest";
import { LAYOUT_PRESETS } from "../../features/workspace/model/layoutPresets";
import {
  LAYOUT_NEEDS_SPLIT_HINT,
  SPLIT_DOWN_ID,
  SPLIT_RIGHT_ID,
  buildLayoutMenuItems,
  layoutPresetFromMenuId,
  layoutPresetMenuId,
} from "./layoutMenu";

describe("layout menu", () => {
  it("lists splits then every preset, checking the current one", () => {
    const items = buildLayoutMenuItems({ current: "grid", canArrange: true });
    const ids = items.flatMap((item) => (item.kind === "item" ? [item.id] : []));
    expect(ids).toEqual([
      SPLIT_RIGHT_ID,
      SPLIT_DOWN_ID,
      ...LAYOUT_PRESETS.map((preset) => layoutPresetMenuId(preset.id)),
    ]);
    const checked = items.filter((item) => item.kind === "item" && item.checked);
    expect(checked.map((item) => item.kind === "item" && item.id)).toEqual(["layout:grid"]);
  });

  it("offers layout creation for a single pane and disables only equalizing", () => {
    const items = buildLayoutMenuItems({ current: null, canArrange: false });
    for (const item of items) {
      if (item.kind !== "item") continue;
      if (layoutPresetFromMenuId(item.id) === "equalize") {
        expect(item.disabled).toBe(true);
        expect(item.title).toBe(LAYOUT_NEEDS_SPLIT_HINT);
      } else {
        expect(item.disabled).toBeFalsy();
        if (layoutPresetFromMenuId(item.id)) expect(item.title).toMatch(/Create [234] panes/);
      }
    }
  });

  it("round-trips menu ids", () => {
    expect(layoutPresetFromMenuId("layout:main-left")).toBe("main-left");
    expect(layoutPresetFromMenuId("layout:nope")).toBeNull();
    expect(layoutPresetFromMenuId("split-right")).toBeNull();
  });
});
