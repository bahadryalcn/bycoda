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
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
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
  type("files to include", "src/**");
  type("files to exclude", "**/generated/**");
  for (const label of ["Match case", "Match whole word", "Use regular expression"])
    act(() => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  act(() => root.unmount());
  root = createRoot(host);
  render();
  expect(input("Search").value).toBe("needle");
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
