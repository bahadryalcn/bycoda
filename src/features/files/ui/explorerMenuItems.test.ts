import { describe, expect, it } from "vitest";
import {
  explorerHeaderItems,
  explorerItems,
  gateBusyMenuItems,
  menuCreateParent,
} from "./explorerMenuItems";

const ids = (items: { kind: string; id?: string }[]) =>
  items.map((item) => (item.kind === "sep" ? "|" : item.id)).join(",");
const icon = () => null;
const header = (options: Partial<Parameters<typeof explorerHeaderItems>[0]> = {}) =>
  explorerHeaderItems(
    {
      narrow: false,
      canSearch: true,
      showExcluded: false,
      excludedDefault: false,
      ...options,
    },
    icon,
  );

describe("Explorer actions menu", () => {
  it("keeps New File and New Folder together, then the rare operations in their own group", () => {
    expect(ids(header())).toBe("new-file,new-folder,|,reveal,excluded,reset");
  });

  it("folds Collapse All and Search in after the creation group only when the header is narrow", () => {
    expect(ids(header({ narrow: true }))).toBe(
      "new-file,new-folder,|,collapse,search,|,reveal,excluded,reset",
    );
    expect(ids(header({ narrow: true, canSearch: false }))).toBe(
      "new-file,new-folder,|,collapse,|,reveal,excluded,reset",
    );
  });

  it("disables creation and reveal with the reason while an operation is pending", () => {
    const items = header({ busyReason: "Wait for the current file operation to finish" });
    for (const id of ["new-file", "new-folder", "reveal"]) {
      expect(items.find((item) => item.kind === "item" && item.id === id)).toMatchObject({
        disabled: true,
      });
    }
    expect(items.find((item) => item.kind === "item" && item.id === "new-file")).toMatchObject({
      description: "Wait for the current file operation to finish",
    });
    expect(items.find((item) => item.kind === "item" && item.id === "excluded")).not.toMatchObject({
      disabled: true,
    });
  });

  it("shows only shortcuts that already exist and reflects the excluded-files preference", () => {
    const items = header({ narrow: true, showExcluded: true });
    const shortcuts = items.flatMap((item) =>
      item.kind === "item" && item.shortcut ? [item.id] : [],
    );
    expect(shortcuts).toEqual(["search"]);
    expect(items.find((item) => item.kind === "item" && item.id === "excluded")).toMatchObject({
      checked: true,
    });
    expect(items.find((item) => item.kind === "item" && item.id === "reset")).toMatchObject({
      disabled: false,
    });
  });
});

describe("Explorer context menu creation", () => {
  const files = { path: "/p/src/a.ts", isDir: false, isRoot: false };
  const folder = { path: "/p/src", isDir: true, isRoot: false };
  const rootTarget = { path: "/p", isDir: true, isRoot: true };
  const build = (target: typeof files, label: string, count = 1) =>
    explorerItems(target, null, true, true, count, true, label);

  it("creates inside the root and folders, and beside a file", () => {
    expect(menuCreateParent(rootTarget)).toBe("/p");
    expect(menuCreateParent(folder)).toBe("/p/src");
    expect(menuCreateParent(files)).toBe("/p/src");
  });

  it.each([
    ["file", files, "src"],
    ["folder", folder, "src"],
    ["root", rootTarget, "Project"],
  ])(
    "offers New File then New Folder first for a %s and names the target",
    (_name, target, label) => {
      const items = build(target, label);
      expect(ids(items).startsWith("new-file,new-folder,|,cut,copy,paste")).toBe(true);
      for (const id of ["new-file", "new-folder"]) {
        expect(items.find((item) => item.kind === "item" && item.id === id)).toMatchObject({
          description: `In ${label}`,
        });
      }
    },
  );

  it("keeps root-only restrictions and the Git entries for a single file", () => {
    const root = build(rootTarget, "Project");
    for (const id of ["cut", "copy", "duplicate", "rename", "delete"]) {
      expect(root.find((item) => item.kind === "item" && item.id === id)).toMatchObject({
        disabled: true,
      });
    }
    expect(ids(build(files, "src"))).toContain("git-history,git-blame");
    expect(ids(build(folder, "src"))).not.toContain("git-history");
  });

  it("disables every mutating item while a file operation runs but leaves copy-path available", () => {
    const gated = gateBusyMenuItems(build(files, "src"), true);
    for (const id of [
      "new-file",
      "new-folder",
      "cut",
      "paste",
      "duplicate",
      "rename",
      "delete",
      "reveal",
    ]) {
      expect(gated.find((item) => item.kind === "item" && item.id === id)).toMatchObject({
        disabled: true,
      });
    }
    expect(gated.find((item) => item.kind === "item" && item.id === "copy-path")).not.toMatchObject(
      {
        disabled: true,
      },
    );
    const open = build(files, "src");
    expect(gateBusyMenuItems(open, false)).toBe(open);
  });
});
