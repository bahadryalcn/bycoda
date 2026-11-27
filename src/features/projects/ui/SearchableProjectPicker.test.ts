// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SearchableProjectPicker } from "./SearchableProjectPicker";
import { invoke } from "@tauri-apps/api/core";

vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => null),
}));
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.render(null));
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the active project's context menu and restores search focus after nested interaction", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onProjectContextMenu = vi.fn();
  const render = (projectMenuActive: boolean) =>
    act(async () =>
      root.render(
        createElement(SearchableProjectPicker, {
          cwd: "/repo",
          recents: [{ path: "/repo", openedAt: 1 }],
          onSelectProject: vi.fn(),
          onProjectContextMenu,
          projectMenuActive,
        }),
      ),
    );
  await render(false);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
  );
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]')!;
  await act(async () =>
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(onProjectContextMenu).toHaveBeenCalledWith(
    "/repo",
    expect.any(Number),
    expect.any(Number),
    search,
  );
  await render(true);
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"][aria-label="Project picker"]')).not.toBeNull();
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere);
  elsewhere.focus();
  await render(false);
  expect(document.activeElement).toBe(search);
  elsewhere.remove();
});

it("keeps broad search results windowed and selects an offscreen project by path", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(32);
  const onSelectProject = vi.fn();
  const recents = Array.from({ length: 100 }, (_, index) => ({
    path: `/projects/${index < 60 ? "team" : "other"}/repo-${index}`,
    openedAt: 100 - index,
  }));
  vi.mocked(invoke).mockClear();
  const checkedLogos = () =>
    vi.mocked(invoke).mock.calls.filter(([command]) => command === "detect_project_logo");
  await act(async () =>
    root.render(
      createElement(SearchableProjectPicker, { cwd: recents[0]!.path, recents, onSelectProject }),
    ),
  );
  expect(checkedLogos()).toEqual([["detect_project_logo", { project: recents[0]!.path }]]);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
  );
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]')!;
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, text);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const options = () => document.querySelectorAll<HTMLElement>('[role="option"]');
  expect(options().length).toBeLessThan(40);
  expect(options()[0]?.getAttribute("aria-setsize")).toBe("100");
  expect(checkedLogos().length).toBeLessThan(40);
  await type("/team/");
  expect(options().length).toBeLessThan(40);
  expect(options()[0]?.getAttribute("aria-setsize")).toBe("60");
  await type("OTHER/REPO-99");
  expect(options()).toHaveLength(1);
  expect(options()[0]!.textContent).toContain("repo-99");
  await act(async () =>
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onSelectProject).toHaveBeenCalledExactlyOnceWith(recents[99]!.path);
});
