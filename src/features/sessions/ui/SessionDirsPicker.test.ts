import { visibleSessionTestText } from "./sessionUiTestText";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDirsPicker, sessionDirCandidates } from "./SessionDirsPicker";
import { pickFolders } from "../../../platform/tauri/fs";
import {
  additionalDirsForSession,
  loadAdditionalDirs,
  loadSessionAdditionalDirs,
  saveAdditionalDirs,
  saveSessionAdditionalDirs,
} from "../../projects/model/additionalDirs";
import { rememberProject } from "../../projects/model/recents";

vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  pickFolders: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
const onProjectChange = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
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

function render(workingDirectory = "/work/web") {
  act(() =>
    root.render(
      createElement(SessionDirsPicker, {
        sessionId: "s1",
        project: "/work/web",
        workingDirectory,
        onProjectChange,
      }),
    ),
  );
}
function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
    visibleSessionTestText(element)?.includes(text),
  );
  expect(found, text).toBeDefined();
  return found!;
}
function click(text: string) {
  act(() => button(text).click());
}
function open() {
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
}
function checkbox(path: string) {
  return document
    .querySelector<HTMLSpanElement>(`span[title="${path}"]`)
    ?.closest("label")
    ?.querySelector<HTMLInputElement>("input");
}
async function browse() {
  await act(async () => button("Choose from").click());
}

describe("session folders", () => {
  it("shows the session working folder by default, even with no other projects", () => {
    render();
    expect(visibleSessionTestText(container)).toBe("web");
    open();
    expect(checkbox("/work/web")?.checked).toBe(true);
    expect(checkbox("/work/web")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Working folder");
    expect(document.body.textContent).not.toContain("No folders");
    expect(additionalDirsForSession("s1", "/work/web")).toEqual([]);
  });

  it("shows the actual worktree folder instead of the base project", () => {
    render("/work/web-worktree");
    expect(visibleSessionTestText(container)).toBe("web-worktree");
    open();
    expect(checkbox("/work/web-worktree")?.checked).toBe(true);
    expect(checkbox("/work/web")).toBeUndefined();
  });

  it("offers every saved local project and scopes selections to this session", () => {
    rememberProject("/other/api");
    rememberProject("remote://host/project");
    expect(sessionDirCandidates("/work/web")).toEqual(["/work/web", "/other/api"]);
    render();
    open();
    act(() => checkbox("/other/api")!.click());
    expect(visibleSessionTestText(container)).toBe("2 folders");
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/other/api"]);
    expect(additionalDirsForSession("s2", "/work/web")).toEqual([]);
    expect(loadAdditionalDirs("/work/web")).toEqual([]);
  });

  it("adds native folder choices, preserves them on reopening and removes them", async () => {
    vi.mocked(pickFolders).mockResolvedValueOnce(["/custom/api", "/custom/ui"]);
    render();
    open();
    await browse();
    expect(pickFolders).toHaveBeenCalledWith("Add folders to this session", true);
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/custom/api", "/custom/ui"]);
    expect(visibleSessionTestText(container)).toBe("3 folders");
    expect(checkbox("/custom/api")?.checked).toBe(true);
    open();
    open();
    expect(checkbox("/custom/api")?.checked).toBe(true);
    act(() => checkbox("/custom/api")!.click());
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/custom/ui"]);
  });

  it("handles cancellation and picker errors without changing selection", async () => {
    saveSessionAdditionalDirs("s1", "/work/web", ["/custom/api"]);
    vi.mocked(pickFolders)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("unavailable"));
    render();
    open();
    await browse();
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/custom/api"]);
    await browse();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not open");
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/custom/api"]);
  });

  it("resets extra folders to the project setting while keeping the working folder", () => {
    saveAdditionalDirs("/work/web", ["/work/api"]);
    saveSessionAdditionalDirs("s1", "/work/web", ["/custom/ui"]);
    render();
    open();
    click("Reset");
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
    expect(checkbox("/work/web")?.checked).toBe(true);
    expect(checkbox("/work/api")?.checked).toBe(true);
  });

  it("changes project through the existing session callback", () => {
    rememberProject("/other/api");
    render();
    open();
    click("Change project…");
    expect(document.body.textContent).toContain("new session");
    click("api");
    expect(onProjectChange).toHaveBeenCalledWith("/other/api");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("changes project through a single-folder native dialog", async () => {
    vi.mocked(pickFolders).mockResolvedValueOnce(["/custom/project"]);
    render();
    open();
    click("Change project…");
    await browse();
    expect(pickFolders).toHaveBeenCalledWith("Choose session project", false);
    expect(onProjectChange).toHaveBeenCalledWith("/custom/project");
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
  });

  it("filters projects by path while keeping the native picker available", () => {
    rememberProject("/other/api");
    render();
    open();
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "missing-project");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("No matching folders");
    expect(checkbox("/other/api")).toBeUndefined();
    expect(button("Choose from").disabled).toBe(false);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());
    expect(input.value).toBe("");
    expect(checkbox("/other/api")).toBeDefined();
    expect(document.activeElement).toBe(input);
  });

  it("rejects a drive root without changing session folders", async () => {
    vi.mocked(pickFolders).mockResolvedValueOnce(["C:/"]);
    render();
    open();
    await browse();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("drive root");
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
    expect(visibleSessionTestText(container)).toBe("web");
  });
});
