// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TurnChangedFile } from "../model/turnChangedFiles";
import { TurnChangedFiles } from "./TurnChangedFiles";

vi.mock("../../files/public/FileTypeIcon", () => ({ FileTypeIcon: () => null }));

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const file = (index: number, status?: TurnChangedFile["status"]): TurnChangedFile => ({
  key: `k${index}`,
  path: `src/f${index}.ts`,
  status,
  counts: { additions: 1, deletions: 0 },
});
const render = (files: TurnChangedFile[]) =>
  act(() => root.render(createElement(TurnChangedFiles, { files })));
const rows = () => host.querySelectorAll("li");

it("shows every row when the list is short and has no expand control", () => {
  render([file(0), file(1)]);
  expect(rows()).toHaveLength(2);
  expect(host.querySelector("button")).toBeNull();
});

it("bounds a long list and expands and collapses on demand", () => {
  render(Array.from({ length: 19 }, (_, i) => file(i)));
  expect(rows()).toHaveLength(6);
  const toggle = host.querySelector("button") as HTMLButtonElement;
  expect(toggle.textContent).toBe("Show 13 more files");
  act(() => toggle.click());
  expect(rows()).toHaveLength(19);
  expect(toggle.textContent).toBe("Show fewer files");
  act(() => toggle.click());
  expect(rows()).toHaveLength(6);
});

it("labels added and deleted files and strikes deleted paths", () => {
  render([file(0, "added"), file(1, "deleted"), file(2, "modified"), file(3)]);
  const items = [...rows()];
  expect(items[0].textContent).toContain("Added");
  expect(items[1].textContent).toContain("Deleted");
  expect(items[2].textContent).not.toMatch(/Added|Deleted/);
  expect(items[3].querySelector("[data-status]")).toBeNull();
  expect(items[1].querySelector("[data-status='deleted']")).not.toBeNull();
  expect(items[1].querySelector(".line-through")).not.toBeNull();
});
