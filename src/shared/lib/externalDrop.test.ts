// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import {
  droppedFileCount,
  droppedFileTypes,
  endExternalDrop,
  nativeDropPointer,
  showExternalDrop,
} from "./externalDrop";

afterEach(() => {
  endExternalDrop();
  document.body.replaceChildren();
});

const badge = () => document.querySelector(".pointer-drop-hint");
const announcer = () => document.querySelector("[data-drag-announcer]")?.textContent;

it("marks one target, shows one badge and announces a sentence once per change", () => {
  const first = document.createElement("div");
  const second = document.createElement("div");
  document.body.append(first, second);
  const pointer = { clientX: 10, clientY: 10 };

  showExternalDrop(first, { kind: "accept", label: "Attach 2 files" }, pointer);
  showExternalDrop(first, { kind: "accept", label: "Attach 2 files" }, pointer);
  expect(first.dataset.dropIndicator).toBe("inside");
  expect(badge()?.textContent).toBe("Attach 2 files");
  expect(announcer()).toBe("Attach 2 files");

  showExternalDrop(second, { kind: "blocked", reason: "Read-only" }, pointer);
  expect(first.dataset.dropIndicator).toBeUndefined();
  expect(second.dataset.dropIndicator).toBe("blocked");
  expect(badge()?.getAttribute("data-action")).toBe("blocked");
  expect(document.querySelectorAll(".pointer-drop-hint")).toHaveLength(1);
  expect(announcer()).toBe("Read-only");

  endExternalDrop();
  expect(badge()).toBeNull();
  expect(second.dataset.dropIndicator).toBeUndefined();
});

it("counts dragged files from items first, then from the file list", () => {
  const items = [{ kind: "file", type: "image/png" }, { kind: "string", type: "text/plain" }, { kind: "file", type: "" }];
  expect(droppedFileCount({ items, files: [] } as never)).toBe(2);
  expect(droppedFileTypes({ items, files: [] } as never)).toEqual(["image/png", ""]);
  expect(droppedFileCount({ items: [], files: [1, 2, 3] } as never)).toBe(3);
  expect(droppedFileCount(null)).toBe(0);
});

it("falls back when a native event carries no position", () => {
  expect(nativeDropPointer(undefined, { clientX: 5, clientY: 6 })).toEqual({
    clientX: 5,
    clientY: 6,
  });
  expect(nativeDropPointer({ x: 30, y: 40 }, { clientX: 5, clientY: 6 })).toEqual({
    clientX: 30,
    clientY: 40,
  });
});
