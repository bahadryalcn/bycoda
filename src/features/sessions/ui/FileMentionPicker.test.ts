// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FileMentionPicker } from "./FileMentionPicker";
import { serverMentionRows } from "../model/serverMentions";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  vi.unstubAllGlobals();
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

const row = (relative: string) => ({
  path: `/repo/${relative}`,
  relative,
  name: relative.split("/").pop()!,
  score: 0,
  positions: [],
});

it("groups an empty query into project root and folders", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(FileMentionPicker, {
        files: [row("README.md"), row("src/app.ts")],
        query: "",
        active: 0,
        onActive: vi.fn(),
        onPick: vi.fn(),
      }),
    ),
  );
  expect(host.textContent).toContain("Project root");
  expect(host.textContent).toContain("Folders");
});

it("offers a rescan when a search finds nothing and when the index is incomplete", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRetry = vi.fn();
  act(() =>
    root.render(
      createElement(FileMentionPicker, {
        files: [],
        query: "zzz",
        active: 0,
        indexNotice: "incomplete",
        onRetry,
        onActive: vi.fn(),
        onPick: vi.fn(),
      }),
    ),
  );
  const rescan = [...host.querySelectorAll("button")].find((b) => b.textContent === "Rescan files");
  expect(rescan).toBeDefined();
  act(() => rescan!.click());
  expect(onRetry).toHaveBeenCalledOnce();
});
