// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  WorkspaceSettingsSurface,
  type WorkspaceSettingsSurfaceProps,
} from "./WorkspaceSettingsSurface";

vi.mock("../surfaces/lazySurfaces", () => ({
  SettingsView: ({ headerAction }: { headerAction?: React.ReactNode }) =>
    createElement("div", null, headerAction, createElement("button", null, "Other control")),
}));

it("keeps the shared modal focus boundary while peeking and restores the toggle on Escape", async () => {
  const outside = document.createElement("button");
  const container = document.createElement("div");
  document.body.append(outside, container);
  const root = createRoot(container);
  const props = {
    presentation: "dialog",
    settingsOpen: true,
    settingsSection: "appearance",
    worktreeManagementRequest: null,
    onCloseSettings: vi.fn(),
  } as unknown as WorkspaceSettingsSurfaceProps;
  try {
    await act(async () => root.render(createElement(WorkspaceSettingsSurface, props)));
    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Preview in app"]')!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".modal-backdrop")).not.toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".modal-backdrop")).toBeNull();
    expect(document.querySelector('[data-settings-dialog-mode="peek"]')).not.toBeNull();
    expect(document.querySelector('[data-modal-placement="end"]')).not.toBeNull();
    await act(async () => outside.focus());
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    await act(async () =>
      document
        .querySelector<HTMLElement>("[data-modal-layer]")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
    );
    expect(props.onCloseSettings).not.toHaveBeenCalled();
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(document.querySelector(".modal-backdrop")).not.toBeNull();
    await act(async () =>
      root.render(
        createElement(WorkspaceSettingsSurface, { ...props, settingsSection: "general" }),
      ),
    );
    expect(document.querySelector('[aria-label="Preview in app"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    outside.remove();
    container.remove();
  }
});
