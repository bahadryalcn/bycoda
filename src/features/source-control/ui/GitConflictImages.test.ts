// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitConflictStages } from "../../../platform/tauri/fs";
import { GitConflictImages } from "./GitConflictImages";

const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0));
const stages: GitConflictStages = {
  path: "/repo/icon.png",
  relative: "icon.png",
  kind: "deleted-by-them",
  base: "",
  ours: "",
  theirs: null,
  binary: true,
  tooLarge: false,
  images: { base: png, ours: png, theirs: null },
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows each version of the pair as a picture, and says when one is missing", () => {
  act(() => root.render(createElement(GitConflictImages, { stages, sides: ["ours", "theirs"] })));
  const images = container.querySelectorAll("img");
  expect(images).toHaveLength(1);
  expect(images[0].getAttribute("src")).toBe(`data:image/png;base64,${png}`);
  expect(images[0].getAttribute("alt")).toBe("Current");
  expect(container.textContent).toContain("Incoming");
  expect(container.textContent).toContain("No version on this side");
});
