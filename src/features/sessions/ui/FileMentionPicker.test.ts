// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FileMentionPicker } from "./FileMentionPicker";
import { serverMentionRows } from "../model/serverMentions";
import { workItemMentionRows } from "../model/workItemMentionRows";
import { composerMentionScope, composerMentionScopeHint } from "../model/composerMentionScopes";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  vi.unstubAllGlobals();
});

it("groups provider and scope shortcuts ahead of workspace paths", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const files = [
    ...workItemMentionRows([], "", ["github", "jira"]),
    ...composerMentionScopeHint("crews:", "", true),
    ...composerMentionScopeHint("notes:", "", true),
    { path: "/repo/src", relative: "src", name: "src", isDir: true, score: 0, positions: [] },
    { path: "/repo/README.md", relative: "README.md", name: "README.md", score: 0, positions: [] },
  ];
  const onPick = vi.fn();
  act(() =>
    root.render(
      createElement(FileMentionPicker, {
        files,
        query: "",
        active: 0,
        includeNotes: true,
        includeWorkItems: true,
        onActive: vi.fn(),
        onPick,
      }),
    ),
  );
  const headings = [...host.querySelectorAll('[role="group"]')].map(
    (group) => document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent,
  );
  expect(headings).toEqual(["Work items", "Crews", "Notes", "Folders", "Files"]);
  const options = host.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(options[0]?.textContent).toBe("Jira@jira:");
  expect(options[1]?.textContent).toBe("GitHub@github:");
  expect(options[2]?.textContent).toBe("Search crews and members@crews:");
  expect(options[3]?.textContent).toBe("Search notes@notes:");
  act(() => options[2]!.click());
  expect(onPick).toHaveBeenCalledExactlyOnceWith(files[2]);
  expect(composerMentionScope("CREWS:data")).toBe("crews:");
  expect(composerMentionScope("notes:release")).toBe("notes:");
  expect(composerMentionScopeHint("notes:", "notes", false)).toEqual([]);
});

it("renders distinct IDs and hands the selected saved server row back to the composer", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const files = serverMentionRows("srv:", [
    { id: "first", name: "Prod", kind: "ssh" },
    { id: "second", name: "Prod", kind: "ssh" },
  ]);
  const onPick = vi.fn();
  act(() =>
    root.render(
      createElement(FileMentionPicker, {
        files,
        query: "srv:",
        active: 0,
        serversScoped: true,
        onActive: vi.fn(),
        onPick,
      }),
    ),
  );
  const options = host.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(options[0]?.textContent).toContain("@srv:first");
  expect(options[1]?.textContent).toContain("@srv:second");
  act(() => options[1]!.click());
  expect(onPick).toHaveBeenCalledExactlyOnceWith(files[1]);
});

it("keeps composer focus and ignores stationary pointer events after keyboard navigation", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const files = ["first.ts", "second.ts"].map((name) => ({
    path: `/repo/${name}`,
    relative: name,
    name,
    score: 0,
    positions: [],
  }));
  const onActive = vi.fn();
  const onPick = vi.fn();
  const editor = document.createElement("input");
  document.body.append(editor);
  editor.focus();
  const render = (active: number) =>
    act(() =>
      root.render(
        createElement(FileMentionPicker, {
          files,
          active,
          query: "",
          onActive,
          onPick,
        }),
      ),
    );
  render(0);
  const first = host.querySelector<HTMLButtonElement>('[role="option"]')!;
  act(() =>
    first.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }),
    ),
  );
  render(1);
  act(() => {
    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    first.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }),
    );
  });
  expect(onActive).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(editor);
  act(() =>
    first.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 21, clientY: 20 }),
    ),
  );
  expect(onActive).toHaveBeenCalledExactlyOnceWith(0);
  act(() => first.click());
  expect(onPick).toHaveBeenCalledExactlyOnceWith(files[0]);
  editor.remove();
});

it("bounds the suggestion list to the shared composer picker height without adding a close control", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(FileMentionPicker, {
        files: [],
        query: "",
        active: 0,
        onActive: vi.fn(),
        onPick: vi.fn(),
      }),
    ),
  );
  expect(host.querySelector('[data-list-height="standard"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Close"]')).toBeNull();
});

it("says the file index is incomplete instead of a bare no-match result", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const render = (indexNotice?: "incomplete" | "unknown", loading = false) =>
    act(() =>
      root.render(
        createElement(FileMentionPicker, {
          files: [],
          active: -1,
          query: "late/path.ts",
          indexNotice,
          loading,
          onActive: vi.fn(),
          onPick: vi.fn(),
        }),
      ),
    );

  render();
  expect(host.textContent).not.toContain("File index");

  render("incomplete");
  expect(host.textContent).toContain("No matching files or folders");
  expect(host.textContent).toContain("File index is incomplete; some files may not appear.");

  render("unknown");
  expect(host.textContent).toContain(
    "File index completeness is unknown; some files may not appear.",
  );

  render("incomplete", true);
  expect(host.textContent).not.toContain("File index");
});
