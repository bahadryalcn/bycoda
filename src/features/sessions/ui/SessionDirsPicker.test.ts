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
  loadProjectRepositoryChoice,
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

function render(workingDirectory = "/work/web", worktreeMode = false) {
  act(() =>
    root.render(
      createElement(SessionDirsPicker, {
        sessionId: "s1",
        project: "/work/web",
        workingDirectory,
        worktreeMode,
      }),
    ),
  );
}
function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === text ||
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
/** The row for a path; `section` is the group it sits in, or none in the repositories list. */
function option(path: string, section?: "Project" | "Also work in") {
  const roots = section
    ? [...document.querySelectorAll('[role="group"]')].filter(
        (element) =>
          document.getElementById(element.getAttribute("aria-labelledby") ?? "")?.textContent ===
          section,
      )
    : [document.body];
  return roots
    .flatMap((group) => [...group.querySelectorAll<HTMLButtonElement>('[role="option"]')])
    .find(
      (item) =>
        document.getElementById(item.getAttribute("aria-describedby") ?? "")?.textContent === path,
    );
}

async function browse(label = "Add folder…") {
  await act(async () => button(label).click());
}

describe("session project and folders", () => {
  it("labels the chip Also work in, whichever folder the session runs in", () => {
    render("/work/web-worktree");
    expect(visibleSessionTestText(container)).toBe("Also work in");
  });

  it("lists other projects under Also work in and has no Project section", () => {
    rememberProject("/other/api");
    render();
    open();
    expect(option("/work/web", "Project")).toBeUndefined();
    expect(option("/work/web", "Also work in")).toBeUndefined();
    expect(option("/other/api", "Also work in")).toBeDefined();
    expect(additionalDirsForSession("s1", "/work/web")).toEqual([]);
  });

  it("scopes extra folders to this session and shows +N on the chip", () => {
    rememberProject("/other/api");
    rememberProject("remote://host/project");
    expect(sessionDirCandidates("/work/web")).toEqual(["/work/web", "/other/api"]);
    render();
    open();
    act(() => option("/other/api", "Also work in")!.click());
    expect(visibleSessionTestText(container)).toBe("Also work in +1");
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
    expect(visibleSessionTestText(container)).toBe("Also work in +2");
    expect(option("/custom/api", "Also work in")?.getAttribute("aria-selected")).toBe("true");
    open();
    open();
    expect(option("/custom/api", "Also work in")?.getAttribute("aria-selected")).toBe("true");
    act(() => option("/custom/api", "Also work in")!.click());
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

  it("translates the native dialog title and picker errors", async () => {
    const { setLanguagePreference } = await import("../../../shared/i18n");
    try {
      await act(async () => {
        await setLanguagePreference("de");
      });
      vi.mocked(pickFolders).mockRejectedValueOnce(new Error("unavailable"));
      render();
      open();
      await act(async () => button("Ordner hinzufügen…").click());
      expect(pickFolders).toHaveBeenCalledWith("Ordner zu dieser Sitzung hinzufügen", true);
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "Der Ordnerauswahldialog konnte nicht geöffnet werden. Bitte versuchen Sie es erneut.",
      );
    } finally {
      await act(async () => {
        await setLanguagePreference("en");
      });
    }
  });

  it("resets extra folders to the project setting", () => {
    saveAdditionalDirs("/work/web", ["/work/api"]);
    saveSessionAdditionalDirs("s1", "/work/web", ["/custom/ui"]);
    render();
    open();
    click("Reset");
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
    expect(option("/work/api", "Also work in")?.getAttribute("aria-selected")).toBe("true");
  });

  it("filters both sections by path while keeping the native picker available", () => {
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
    expect(option("/other/api", "Also work in")).toBeUndefined();
    expect(button("Add folder…").disabled).toBe(false);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());
    expect(input.value).toBe("");
    expect(option("/other/api", "Also work in")).toBeDefined();
    expect(document.activeElement).toBe(input);
  });

  it("rejects a drive root without changing session folders", async () => {
    vi.mocked(pickFolders).mockResolvedValueOnce(["C:/"]);
    render();
    open();
    await browse();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("drive root");
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
    expect(visibleSessionTestText(container)).toBe("Also work in");
  });
});

describe("repositories of a new worktree", () => {
  it("lists the project folders as repositories with the worktree hint", () => {
    saveAdditionalDirs("/work/web", ["/work/api", "/work/ui"]);
    rememberProject("/other/unrelated");
    render("/work/web", true);
    expect(visibleSessionTestText(container)).toBe("All repositories");
    open();
    expect(document.body.textContent).toContain(
      "Each gets its own worktree on the session's branch",
    );
    expect(option("/work/api")?.getAttribute("aria-selected")).toBe("true");
    expect(option("/work/ui")?.getAttribute("aria-selected")).toBe("true");
    expect(option("/other/unrelated")).toBeUndefined();
    expect(option("/work/web")).toBeUndefined();
  });

  it("counts, selects none and selects all, remembering the choice for the project", () => {
    saveAdditionalDirs("/work/web", ["/work/api", "/work/ui"]);
    render("/work/web", true);
    open();
    act(() => option("/work/ui")!.click());
    expect(visibleSessionTestText(container)).toBe("1 repositories");
    expect(loadProjectRepositoryChoice("/work/web")).toEqual(["/work/api"]);
    click("Select none");
    expect(visibleSessionTestText(container)).toBe("No repositories");
    click("Select all");
    expect(visibleSessionTestText(container)).toBe("All repositories");
    // The session's own folders stay untouched.
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
  });

  it("adds picked folders to the project's folder list and the choice", async () => {
    saveAdditionalDirs("/work/web", ["/work/api"]);
    vi.mocked(pickFolders).mockResolvedValueOnce(["/custom/lib"]);
    render("/work/web", true);
    open();
    await browse();
    expect(pickFolders).toHaveBeenCalledWith("Add folders to this project", true);
    expect(loadAdditionalDirs("/work/web")).toEqual(["/work/api", "/custom/lib"]);
    expect(loadProjectRepositoryChoice("/work/web")).toEqual(["/work/api", "/custom/lib"]);
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/work/api", "/custom/lib"]);
  });
});
