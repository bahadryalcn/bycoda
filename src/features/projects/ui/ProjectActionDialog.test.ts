// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectActionDialog } from "./ProjectActionDialog";
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
    expect(document.querySelector('[role="switch"]')).toBeNull();
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
    await act(async () => document.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
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
