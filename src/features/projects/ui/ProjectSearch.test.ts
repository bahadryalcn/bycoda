// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSearch } from "./ProjectSearch";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";

vi.mock("../../search/model/search", () => ({
  cancelProjectSearch: vi.fn(async () => {}),
  searchProject: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
const search = vi.fn(async () => ({ matches: [], truncated: false }));
beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  search.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (cwd = "/repo") =>
  act(() =>
    root.render(
      createElement(ProjectSearch, {
        cwd,
        onClose: vi.fn(),
        onOpenFile: vi.fn(),
        search,
      }),
    ),
  );
const input = (label: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
function type(label: string, value: string) {
  act(() => {
    const field = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("restores find text and all filters on return, reruns search, and isolates other projects", async () => {
  render();
  type("Search", "needle");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click());
  type("files to include", "src/**");
  type("files to exclude", "**/generated/**");
  for (const label of ["Match case", "Match whole word", "Use regular expression"])
    act(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  act(() => root.unmount());
  root = createRoot(host);
  render();
  expect(input("Search").value).toBe("needle");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click());
  expect(input("files to include").value).toBe("src/**");
  expect(input("files to exclude").value).toBe("**/generated/**");
  await act(async () => vi.advanceTimersByTime(210));
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cwd: "/repo",
      query: "needle",
      include: "src/**",
      exclude: "**/generated/**",
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    }),
  );
  render("/other");
  expect(input("Search").value).toBe("");
  render();
  expect(input("Search").value).toBe("needle");
});
it("resets advanced filters without clearing the retained query", async () => {
  render();
  type("Search", "needle");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click());
  type("files to include", "src/**");
  type("files to exclude", "generated/**");
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Match case"]')!.click());
  expect(host.querySelector('[aria-label="Filters"]')?.getAttribute("data-button-selected")).toBe(
    "true",
  );
  const reset = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (node) => node.textContent === "Reset",
  )!;
  act(() => reset.click());
  expect(input("Search").value).toBe("needle");
  expect(input("files to include").value).toBe("");
  expect(input("files to exclude").value).toBe("");
  expect(
    host.querySelector('[aria-label="Filters"]')?.getAttribute("data-button-selected"),
  ).toBeNull();
  await act(async () => vi.advanceTimersByTime(210));
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: "needle",
      include: undefined,
      exclude: undefined,
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    }),
  );
});
