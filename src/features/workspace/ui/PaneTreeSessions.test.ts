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
  const { createElement, useLayoutEffect, useRef } = await import("react");
  return {
    SessionPane: ({
      session,
      reviewUndoLocked,
    }: {
      session: Session;
      reviewUndoLocked: boolean;
    }) => {
      const pane = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => {
        if (pane.current) pane.current.dataset.connectedAtMount = String(pane.current.isConnected);
      }, []);
      useLayoutEffect(() => {
        const node = pane.current!;
        node.dataset.listening = "true";
        return () => {
          node.dataset.listening = "false";
        };
      }, []);
      return createElement(
        "div",
        {
          ref: pane,
          "data-session": session.id,
          "data-title": session.title,
          "data-undo-locked": String(reviewUndoLocked),
        },
        createElement("input", { defaultValue: "Existing draft" }),
      );
    },
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

function render(visible = true, sessionOutlet?: ComponentProps<typeof PaneTree>["sessionOutlet"]) {
  const noop = () => {};
  const props = {
    visible,
    sessionOutlet,
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
    [...container.querySelectorAll("[data-session]")].map((node) =>
      node.getAttribute("data-title"),
    ),
  ).toEqual(["a", "b"]);
});

it("parks one local preview with its input and resumes only the freshly selected session", () => {
  const show = (id: string, preview = true) =>
    act(() =>
      root.render(
        createElement(PaneTree, {
          visible: true,
          previewSessionId: preview ? id : undefined,
          layout: leaf(id),
          editorPanes: [],
          dirtyFileIds: new Set(),
          fileErrorCounts: new Map(),
          focusedId: id,
          composerFocused: false,
          recents: [],
          onFocus: vi.fn(),
          onClose: vi.fn(),
        } as unknown as ComponentProps<typeof PaneTree>),
      ),
    );
  const pane = (id: string) => container.querySelector<HTMLElement>(`[data-session="${id}"]`);
  const saved = session("a");
  update("a", saved);
  show("a");
  const input = pane("a")!.querySelector("input")!;
  input.setSelectionRange(2, 5);
  show("b");
  // The detached preview leaves the live store after its idle timer.
  act(() => setSessions((all) => all.filter((item) => item.id !== "a")));
  expect(pane("a")?.dataset.listening).toBe("false");
  expect(pane("b")?.dataset.listening).toBe("true");
  act(() => setSessions((all) => [...all, { ...saved, title: "Current history" }]));
  show("a");
  expect(pane("a")?.querySelector("input")).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
  expect(pane("a")?.dataset.title).toBe("Current history");
  expect(pane("a")?.dataset.listening).toBe("true");
  act(() => setSessions((all) => [...all, session("c")]));
  show("c");
  expect(pane("b")).toBeNull();
  expect(pane("a")).not.toBeNull();
  show("c", false);
  expect(pane("a")).toBeNull();

  // An external draft may make a revisited session open as a kept tab. It must
  // read its new draft, even if the old preview's input still exists.
  show("a");
  const formerlyBlank = pane("a")?.querySelector("input");
  show("b");
  show("a", false);
  expect(pane("a")?.querySelector("input")).not.toBe(formerlyBlank);

  show("a");
  const previousRevision = pane("a")?.querySelector("input");
  show("b");
  update("a", { blocks: [{ id: "new-turn", role: "user", text: "Newer revision" }] });
  show("a");
  expect(pane("a")?.querySelector("input")).not.toBe(previousRevision);
});

it("moves only the exact session to the outlet and keeps its existing content mounted", () => {
  const outlet = document.createElement("div");
  document.body.append(outlet);
  try {
    render();
    const pane = container.querySelector<HTMLElement>('[data-session="a"]')!;
    expect(pane.dataset.connectedAtMount).toBe("true");
    const input = pane.querySelector("input")!;
    input.focus();
    input.setSelectionRange(1, 4);
    pane.scrollTop = 96;
    const destination = {
      element: outlet,
      overlay: null,
      sessionId: "a",
      projectPath: "/elsewhere",
    };
    render(true, destination);
    expect(outlet.childElementCount).toBe(0);
    render(true, { ...destination, projectPath: "/repo" });
    expect(outlet.querySelector('[data-session="a"]')).toBe(pane);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(4);
    expect(pane.scrollTop).toBe(96);
    expect(container.querySelector('[data-session="b"]')).not.toBeNull();
    render();
    expect(container.querySelector('[data-session="a"]')).toBe(pane);
    expect(document.activeElement).toBe(input);
    expect(pane.scrollTop).toBe(96);
    expect(outlet.childElementCount).toBe(0);
  } finally {
    outlet.remove();
  }
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
