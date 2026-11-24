// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolInspectionPanel } from "./ToolInspectionPanel";
import type { Block } from "../model/session";

const size = vi.hoisted(() => ({ width: 900 }));
vi.mock("../../../shared/lib/observeResize", () => ({
  observeResize: (_node: Element, listener: (entry: unknown) => void) => {
    listener({ contentRect: { width: size.width } });
    return () => {};
  },
}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyMessage: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const patch = "@@ -1,2 +1,2 @@\n keep\n-old\n+new";
const block = (text: string): Block => ({
  id: "d",
  role: "tool",
  text: "Edit",
  tool: { preview: { kind: "write", inspection: { kind: "diff", text } } },
});
const render = (text = patch) =>
  act(async () => root.render(createElement(ToolInspectionPanel, { block: block(text) })));
const radio = (name: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (node) => node.textContent === name,
  )!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opens unified and switches to aligned columns on request", async () => {
  await render();
  expect(container.querySelector("[data-split-diff]")).toBeNull();
  expect(container.querySelector("pre")?.textContent).toBe(patch);
  await act(async () => radio("Split").click());
  expect(container.querySelector("[data-split-diff]")).not.toBeNull();
  expect(container.querySelector("pre")).toBeNull();
  await act(async () => radio("Unified").click());
  expect(container.querySelector("[data-split-diff]")).toBeNull();
});

it("keeps unified and disables Split when the inspector is narrow", async () => {
  size.width = 400;
  await render();
  expect((radio("Split") as HTMLButtonElement).disabled).toBe(true);
  size.width = 900;
});
