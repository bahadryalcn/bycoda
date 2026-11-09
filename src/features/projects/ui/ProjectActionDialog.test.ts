// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectActionDialog } from "./ProjectActionDialog";

const fs = vi.hoisted(() => ({
  readTextFile: vi.fn(async (_path: string): Promise<string> => {
    throw new Error("missing");
  }),
  statFiles: vi.fn(async (paths: string[]) => paths.map((path) => ({ path, mtimeMs: null }))),
}));
vi.mock("../../../platform/tauri/fs", () => fs);
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
it("explains missing fields and saves a preset with a recorded shortcut and browser preference", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSave = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectActionDialog, {
          action: { id: "new", name: "", icon: "play", command: "", url: "" },
          actions: [],
          cwd: "C:/project",
          editing: false,
          error: "",
          onSave,
          onClose: vi.fn(),
          onDelete: vi.fn(),
        }),
      ),
    );
    const button = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (value) => value.textContent === text,
      )!;
    expect(button("Save action").disabled).toBe(true);
    expect(document.body.textContent).toContain("Enter a name for this action.");
    await act(async () => button("Dev server").click());
    expect(document.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(true);
    expect(document.querySelectorAll('[type="checkbox"]')).toHaveLength(1);
    await act(async () => document.querySelector<HTMLInputElement>('[type="checkbox"]')!.click());
    expect(button("Save action").disabled).toBe(false);
    const shortcut = document.querySelector<HTMLInputElement>(
      'input[placeholder="Click here and press a shortcut"]',
    )!;
    await act(async () =>
      shortcut.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "y",
          code: "KeyY",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(shortcut.value).toContain("Y");
    await act(async () =>
      document.querySelectorAll<HTMLInputElement>('[type="checkbox"]')[1]!.click(),
    );
    await act(async () => button("Save action").click());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Dev server",
        command: "pnpm dev",
        shortcut: "Control+Option+KeyY",
        openUrlOnRun: false,
        devServer: false,
      }),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("selects an action glyph without submitting or discarding the current draft", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSave = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectActionDialog, {
          action: {
            id: "existing",
            name: "Keep this name",
            icon: "play",
            command: "pnpm test",
            url: "",
          },
          actions: [],
          cwd: "C:/fixture/project",
          editing: true,
          error: "",
          onSave,
          onClose: vi.fn(),
          onDelete: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click(),
    );
    const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (item) => item.textContent?.includes("Code"),
    )!;
    await act(async () => choice.click());
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>("input[required]")?.value).toBe(
      "Keep this name",
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent === "Save action")!
        .click(),
    );
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "Keep this name",
        command: "pnpm test",
        icon: "code",
      }),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("suggests the project's package.json scripts instead of generic examples", async () => {
  fs.readTextFile.mockImplementation(async (path) => {
    if (!path.endsWith("package.json")) throw new Error("missing");
    return JSON.stringify({
      packageManager: "pnpm@9.0.0",
      scripts: {
        lint: "eslint .",
        dev: "vite",
        test: "vitest",
        build: "vite build",
        e2e: "x",
      },
    });
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSave = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectActionDialog, {
          action: { id: "new", name: "", icon: "play", command: "", url: "" },
          actions: [
            {
              id: "a",
              name: "Lint",
              icon: "code",
              command: "pnpm run lint",
              url: "",
            },
          ],
          cwd: "C:/fixture/project",
          editing: false,
          error: "",
          onSave,
          onClose: vi.fn(),
          onDelete: vi.fn(),
        }),
      ),
    );
    const texts = [...document.querySelectorAll("button")].map((item) => item.textContent);
    expect(document.body.textContent).toContain("Scripts from package.json");
    expect(texts).toEqual(expect.arrayContaining(["dev", "test", "build", "e2e"]));
    expect(texts).not.toContain("lint");
    expect(texts).not.toContain("Dev server");
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent === "dev")!
        .click(),
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent === "Save action")!
        .click(),
    );
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "dev",
        command: "pnpm run dev",
        url: "http://localhost:5173",
        devServer: true,
      }),
    );
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("source");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
