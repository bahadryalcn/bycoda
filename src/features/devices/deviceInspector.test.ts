import { expect, it } from "vitest";
import { hitTestDeviceNodes } from "./deviceInspector";

it("picks the smallest containing native node and rejects invalid geometry", () => {
  const base = { label: "", role: "Button", enabled: true, clickable: true };
  const nodes = [
    { ...base, id: "screen", bounds: { x: 0, y: 0, width: 100, height: 200 } },
    { ...base, id: "button", bounds: { x: 10, y: 20, width: 30, height: 40 } },
    { ...base, id: "invalid", bounds: { x: 10, y: 20, width: NaN, height: 1 } },
  ];
  expect(hitTestDeviceNodes(nodes, 20, 30)?.id).toBe("button");
  expect(hitTestDeviceNodes(nodes, 80, 90)?.id).toBe("screen");
  expect(hitTestDeviceNodes(nodes, 101, 0)).toBeUndefined();
  expect(hitTestDeviceNodes(nodes, NaN, 20)).toBeUndefined();
});

it("selects an enabled clickable container above a smaller text child", () => {
  const nodes = [
    {
      id: "row",
      label: "Search settings",
      role: "LinearLayout",
      enabled: true,
      clickable: true,
      bounds: { x: 0, y: 0, width: 100, height: 60 },
    },
    {
      id: "text",
      label: "Search settings",
      role: "TextView",
      enabled: true,
      clickable: false,
      bounds: { x: 10, y: 10, width: 60, height: 20 },
    },
  ];
  expect(hitTestDeviceNodes(nodes, 20, 20)?.id).toBe("row");
  expect(hitTestDeviceNodes([{ ...nodes[0], clickable: false }, nodes[1]], 20, 20)?.id).toBe(
    "text",
  );
});

it("ignores disabled nodes as actions while retaining their geometry for layout inspection", () => {
  const parent = {
    id: "parent",
    label: "Parent",
    role: "LinearLayout",
    enabled: true,
    clickable: true,
    bounds: { x: 0, y: 0, width: 100, height: 60 },
  };
  const child = {
    id: "child",
    label: "Child",
    role: "Button",
    enabled: false,
    clickable: true,
    bounds: { x: 10, y: 10, width: 60, height: 20 },
  };
  expect(hitTestDeviceNodes([parent, child], 20, 20)?.id).toBe("parent");
  expect(
    hitTestDeviceNodes(
      [
        { ...parent, enabled: false },
        { ...child, enabled: true },
      ],
      20,
      20,
    )?.id,
  ).toBe("child");
  expect(hitTestDeviceNodes([{ ...parent, enabled: false }, child], 20, 20)?.id).toBe("child");
});
