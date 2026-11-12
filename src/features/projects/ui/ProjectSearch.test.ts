// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSearch } from "./ProjectSearch";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { ProjectSearchResult } from "../../search/model/search";

vi.mock("../../search/model/search", () => ({
  cancelProjectSearch: vi.fn(async () => {}),
  searchProject: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
const search = vi.fn<(_: unknown) => Promise<ProjectSearchResult>>(async () => ({
  matches: [],
  truncated: false,
}));
const onOpenFile = vi.fn();
beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  search.mockReset().mockResolvedValue({ matches: [], truncated: false });
  onOpenFile.mockClear();
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
        onOpenFile,
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

const found = (name: string): ProjectSearchResult => ({
  matches: [
    { path: `/repo/${name}.ts`, relative: `${name}.ts`, line: 1, column: 1, preview: name },
  ],
  truncated: false,
});
function enter() {
  act(() =>
    input("Search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
}
it("keeps option toggles inside the query frame and shares inline details controls", () => {
  render();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('[aria-label="Filters"]')).toBeNull();
  const frame = input("Search").closest("[data-ui-focus-group]")!;
  for (const label of ["Match case", "Match whole word", "Use regular expression"]) {
    const toggle = frame.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("data-button-selected")).toBe("true");
  }
  const controls = host.querySelectorAll<HTMLButtonElement>('[aria-label="Toggle Search Details"]');
  expect(controls).toHaveLength(2);
  const details = document.getElementById(controls[0].getAttribute("aria-controls")!)!;
  expect(details.hidden).toBe(true);
  act(() => controls[0].click());
  expect(details.hidden).toBe(false);
  expect([...controls].map((button) => button.getAttribute("aria-expanded"))).toEqual([
    "true",
    "true",
  ]);
  for (const label of ["files to include", "files to exclude"]) {
    const field = input(label);
    expect(details.contains(field)).toBe(true);
    expect(host.querySelector(`label[for="${field.id}"]`)?.textContent).toBe(label);
  }
  type("files to include", "src/**");
  act(() => controls[1].click());
  expect(details.hidden).toBe(true);
  expect(input("files to include").value).toBe("src/**");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("defaults details to collapsed again when no path filters were retained", () => {
  render();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Toggle Search Details"]')!.click());
  render("/other");
  render();
  expect(
    host.querySelector('[aria-label="Toggle Search Details"]')?.getAttribute("aria-expanded"),
  ).toBe("false");
});
it.each(["", "~"])(
  "skips unavailable folder %j and recovers the retained valid search",
  async (cwd) => {
    render();
    type("Search", "needle");
    render(cwd);
    await act(async () => vi.advanceTimersByTime(210));
    expect(host.textContent).toBe("No project folder");
    expect(host.querySelector("input")).toBeNull();
    expect(search).not.toHaveBeenCalled();
    search.mockResolvedValueOnce(found("needle"));
    render();
    expect(input("Search").value).toBe("needle");
    expect(host.textContent).toContain("Searching…");
    await act(async () => vi.advanceTimersByTime(210));
    expect(search).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Searching…");
    enter();
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(
      "/repo/needle.ts",
      { line: 1, column: 1 },
      { exact: true, pin: false },
    );
  },
);
it.each(["query", "include", "exclude", "case", "word", "regex"] as const)(
  "disables previous results during debounce and pending %s replacement",
  async (change) => {
    search.mockResolvedValueOnce(found("oldneedle"));
    let resolve!: (result: ProjectSearchResult) => void;
    search.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render();
    type("Search", "oldneedle");
    await act(async () => vi.advanceTimersByTime(210));
    expect(host.textContent).toContain("oldneedle.ts");
    if (change === "query") type("Search", "newneedle");
    else {
      if (change === "include" || change === "exclude") {
        act(() =>
          host.querySelector<HTMLButtonElement>('[aria-label="Toggle Search Details"]')!.click(),
        );
        type(`files to ${change}`, "src/**");
      } else {
        const label = {
          case: "Match case",
          word: "Match whole word",
          regex: "Use regular expression",
        }[change]!;
        act(() => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
      }
    }
    expect(host.textContent).not.toContain("oldneedle.ts");
    enter();
    expect(onOpenFile).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(210));
    enter();
    expect(onOpenFile).not.toHaveBeenCalled();
    await act(async () => resolve(found("newneedle")));
    enter();
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(
      "/repo/newneedle.ts",
      { line: 1, column: 1 },
      { exact: true, pin: false },
    );
    act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("newneedle"))!
        .click(),
    );
    expect(onOpenFile).toHaveBeenCalledTimes(2);
  },
);

it("ignores an old project's delayed completion after switching projects", async () => {
  let resolve!: (result: ProjectSearchResult) => void;
  search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render();
  type("Search", "oldneedle");
  await act(async () => vi.advanceTimersByTime(210));
  render("/other");
  await act(async () => resolve(found("oldneedle")));
  enter();
  expect(host.textContent).not.toContain("oldneedle.ts");
  expect(onOpenFile).not.toHaveBeenCalled();
});
it("restores find text and all filters on return, reruns search, and isolates other projects", async () => {
  render();
  type("Search", "needle");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Toggle Search Details"]')!.click());
  type("files to include", "src/**");
  type("files to exclude", "**/generated/**");
  for (const label of ["Match case", "Match whole word", "Use regular expression"])
    act(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
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
it("resets advanced filters without clearing the retained query", async () => {
  render();
  type("Search", "needle");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Toggle Search Details"]')!.click());
  type("files to include", "src/**");
  type("files to exclude", "generated/**");
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Match case"]')!.click());
  expect(
    host.querySelector('[aria-label="Match case"]')?.getAttribute("data-button-selected"),
  ).toBe("true");
  const reset = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "Reset",
  )!;
  act(() => reset.click());
  expect(input("Search").value).toBe("needle");
  expect(input("files to include").value).toBe("");
  expect(input("files to exclude").value).toBe("");
  expect(
    host.querySelector('[aria-label="Match case"]')?.getAttribute("data-button-selected"),
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
it("labels a result's line number as a line gutter", async () => {
  search.mockResolvedValueOnce({
    matches: [{ path: "/repo/a.ts", relative: "a.ts", line: 64, column: 1, preview: "needle" }],
    truncated: false,
  });
  render();
  type("Search", "needle");
  await act(async () => vi.advanceTimersByTime(210));
  expect(host.querySelector('[aria-label="Line 64"]')?.textContent).toBe("64");
});
