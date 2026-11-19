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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
const recorder = () =>
  document.querySelector<HTMLButtonElement>('button[aria-pressed][aria-label="Keybinding"]')!;
// `act` returns a thenable whose `then` yields nothing, so the event is returned after awaiting it.
const press = async (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};
async function mountDialog(props: { onClose?: () => void; onSave?: () => void } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(ProjectActionDialog, {
        action: { id: "a", name: "Dev", icon: "play", command: "pnpm dev", url: "" },
        actions: [],
        cwd: "C:/project",
        editing: true,
        error: "",
        onSave: props.onSave ?? vi.fn(),
        onClose: props.onClose ?? vi.fn(),
        onDelete: vi.fn(),
      }),
    ),
  );
  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
}

it("keeps Escape closing the dialog outside capture and cancels only an active capture", async () => {
  const onClose = vi.fn();
  const unmount = await mountDialog({ onClose });
  try {
    // Focused but not capturing: Escape is the dialog's, never a "Include Ctrl, Alt or Command" warning.
    recorder().focus();
    const idle = await press(recorder(), { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(idle.defaultPrevented).toBe(true);
    expect(document.body.textContent).not.toContain("Include Ctrl, Alt or Command");
    onClose.mockClear();
    // Capturing: Escape ends the capture and the dialog stays open.
    await act(async () => recorder().click());
    expect(recorder().getAttribute("aria-pressed")).toBe("true");
    await press(recorder(), { key: "Escape", code: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(recorder().getAttribute("aria-pressed")).toBe("false");
    // Back outside capture, the next Escape closes the dialog.
    await press(recorder(), { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await unmount();
  }
});

it("leaves an IME candidate's Escape to the input method, in and out of capture", async () => {
  const onClose = vi.fn();
  const unmount = await mountDialog({ onClose });
  try {
    for (const init of [
      { key: "Escape", code: "Escape", isComposing: true },
      { key: "Escape", code: "Escape", keyCode: 229 },
    ]) {
      const idle = await press(recorder(), init);
      expect(idle.defaultPrevented).toBe(false);
      await act(async () => recorder().click());
      const capturing = await press(recorder(), init);
      expect(capturing.defaultPrevented).toBe(false);
      expect(recorder().getAttribute("aria-pressed")).toBe("true");
      await act(async () => recorder().blur());
    }
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    await unmount();
  }
});

it("describes the clear shortcut key before capture without requiring hover", async () => {
  const unmount = await mountDialog();
  try {
    const description = recorder().getAttribute("aria-describedby");
    expect(description).toBeTruthy();
    expect(document.getElementById(description!)?.textContent).toContain("Del disables");
  } finally {
    await unmount();
  }
});

it("records a chord into the stored form without saving or closing the dialog by itself", async () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const unmount = await mountDialog({ onSave, onClose });
  try {
    await act(async () => recorder().click());
    // Ctrl+K belongs to another command, so the save would be disabled; use a free chord.
    await press(recorder(), {
      key: "y",
      code: "KeyY",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    expect(recorder().getAttribute("aria-pressed")).toBe("false");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent === "Save action")!
        .click(),
    );
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ shortcut: expect.stringContaining("KeyY") }),
    );
  } finally {
    await unmount();
  }
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
          error: null,
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
    const shortcut = recorder();
    await act(async () => shortcut.click());
    await press(shortcut, { key: "y", code: "KeyY", ctrlKey: true, altKey: true });
    expect([...document.querySelectorAll("kbd")].map((cap) => cap.textContent)).toContain("Y");
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
          error: null,
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
          error: null,
          onSave,
          onClose: vi.fn(),
          onDelete: vi.fn(),
        }),
      ),
    );
    const texts = [...document.querySelectorAll("button")].map((item) => item.textContent);
    expect(document.body.textContent).toContain("Scripts from package.json");
    expect(texts).toEqual(expect.arrayContaining(["dev", "test", "build", "lint"]));
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === "lint",
      )!.disabled,
    ).toBe(true);
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
