// @vitest-environment happy-dom
import { act, createElement, Profiler, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { resetSessionsStore, setSessions } from "../../sessions/model/sessionsStore";
import { leaf, splitPane } from "../model/layout";
import { PaneTree } from "./PaneTree";

vi.mock("../../files/ui/FilePane", () => ({ FilePane: () => null }));
vi.mock("../../sessions/ui/SessionPane", async () => {
  const { createElement } = await import("react");
  return {
    SessionPane: ({ session, reviewUndoLocked }: { session: Session; reviewUndoLocked: boolean }) =>
      createElement("div", {
        "data-session": session.id,
        "data-title": session.title,
        "data-undo-locked": String(reviewUndoLocked),
      }),
  };
});

const session = (id: string, cwd = "/repo"): Session => ({
  ...newSession("codex", cwd),
  id,
  title: id,
});

let container: HTMLDivElement;
let root: Root;
let commits = 0;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  commits = 0;
  resetSessionsStore([session("a"), session("b"), session("other", "/elsewhere")]);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(visible = true) {
  const noop = () => {};
  const props = {
    visible,
    layout: splitPane(leaf("a"), "a", "right", "b"),
    editorPanes: [],
    dirtyFileIds: new Set<string>(),
    fileErrorCounts: new Map<string, number>(),
    focusedId: "a",
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
  } as unknown as ComponentProps<typeof PaneTree>;
  act(() =>
    root.render(
      createElement(
        Profiler,
        {
          id: "tree",
          onRender: () => {
            commits += 1;
          },
        },
        createElement(PaneTree, props),
      ),
    ),
  );
}

const update = (id: string, patch: Partial<Session>) =>
  act(() =>
    setSessions((sessions) =>
      sessions.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    ),
  );

it("reads each pane's session from the store without a sessions prop", () => {
  render();
  expect(
    [...container.querySelectorAll("[data-session]")].map((node) => node.getAttribute("data-title")),
  ).toEqual(["a", "b"]);
});

it("does not re-render for a status change in a session it does not show", () => {
  render();
  const before = commits;
  update("other", { title: "renamed elsewhere" });
  expect(commits).toBe(before);
});

it("re-renders when a shown session changes", () => {
  render();
  const before = commits;
  update("b", { title: "renamed" });
  expect(commits).toBeGreaterThan(before);
  expect(container.querySelector('[data-session="b"]')?.getAttribute("data-title")).toBe("renamed");
});

it("locks review undo while another session in the same checkout is busy", () => {
  render();
  update("b", { busy: true });
  expect(container.querySelector('[data-session="a"]')?.getAttribute("data-undo-locked")).toBe(
    "true",
  );
  expect(container.querySelector('[data-session="b"]')?.getAttribute("data-undo-locked")).toBe(
    "false",
  );
});

it("keeps a hidden tree still while its sessions change", () => {
  render(false);
  const before = commits;
  update("a", { title: "changed while hidden" });
  expect(commits).toBe(before);
});
