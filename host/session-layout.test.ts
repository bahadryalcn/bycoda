import { describe, expect, it } from "vitest";
import { parseSessionLayout } from "./session-layout";

describe("desktop session layout validation", () => {
  const layout = { folders: [{ id: "f", name: "Folder", sessionIds: ["s", "s"], collapsed: true, parentId: "p", ordered: true }], order: { loose: ["s", "s"] } };
  it("copies only bounded typed organization and removes duplicate members", () => {
    expect(parseSessionLayout({ ...layout, credentials: "never copy" })).toEqual({
      folders: [{ ...layout.folders[0], sessionIds: ["s"] }], order: { loose: ["s"] },
    });
  });
  it("drops malformed or oversized optional layouts", () => {
    expect(parseSessionLayout({ ...layout, order: { loose: [42] } })).toBeUndefined();
    expect(parseSessionLayout({ ...layout, folders: [...layout.folders, ...layout.folders] })).toBeUndefined();
    expect(parseSessionLayout({ ...layout, folders: [{ ...layout.folders[0], name: "bad\0name" }] })).toBeUndefined();
    expect(parseSessionLayout({ ...layout, folders: Array(10001).fill(layout.folders[0]) })).toBeUndefined();
    expect(parseSessionLayout({ ...layout, folders: [{ ...layout.folders[0], parentId: "f" }] })).toBeUndefined();
    expect(parseSessionLayout({ ...layout, folders: Array.from({ length: 5 }, (_, i) => ({
      id: `f${i}`, name: "Folder", sessionIds: [], collapsed: false, ...(i ? { parentId: `f${i - 1}` } : {}),
    })) })).toBeUndefined();
  });
});
