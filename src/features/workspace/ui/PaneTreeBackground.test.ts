// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LayoutNode } from "../model/layout";
import { PaneTree } from "./PaneTree";
import { newSession } from "../../sessions/model/session";
import { syncPaneBackground } from "../../../shared/lib/paneBackground";

vi.mock("../../files/ui/FilePane", () => ({ FilePane: () => null }));
vi.mock("../../sessions/ui/SessionPane", () => ({
  SessionPane: () => createElement("div", { className: "chat-pane-background" }),
}));

let container: HTMLDivElement;
let root: Root;

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

function render(sizes: number[]) {
  const noop = vi.fn();
  const layout: LayoutNode = {
    type: "split",
    id: "split",
    dir: "right",
    children: [
      { type: "leaf", id: "a" },
      { type: "leaf", id: "b" },
    ],
    sizes,
  };
  const props = new Proxy(
    {
      visible: true,
      layout,
      sessions: ["a", "b"].map((id) => ({ ...newSession("claude", "/project"), id })),
      editorPanes: [],
      dirtyFileIds: new Set(),
      fileErrorCounts: new Map(),
      focusedId: "a",
      composerFocused: false,
      recents: [],
    } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : noop) },
  ) as unknown as ComponentProps<typeof PaneTree>;
  act(() => root.render(createElement(PaneTree, props)));
}

const layers = () => [...container.querySelectorAll<HTMLElement>(".chat-pane-background")];
const left = (element: HTMLElement) => element.style.getPropertyValue("--chat-background-left");

it("places the shared artwork on each pane's layer, not on the pane subtree", () => {
  render([0.5, 0.5]);
  expect(layers().map(left)).toEqual(["0%", "-100%"]);
  expect(layers()[1].style.getPropertyValue("--chat-background-width")).toBe("200%");

  render([0.25, 0.75]);
  expect(left(layers()[1])).toBe(`${(-0.25 / 0.75) * 100}%`);
});

it("lets a layer that mounts later adopt its leaf's placement", () => {
  render([0.5, 0.5]);
  const late = document.createElement("div");
  const leaf = layers()[1].closest<HTMLElement>("[data-pane-leaf]")!;
  leaf.append(late);

  syncPaneBackground(leaf, late);

  expect(left(late)).toBe("-100%");
});
