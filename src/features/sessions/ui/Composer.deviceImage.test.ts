// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { attachDeviceImage, type DeviceImageDraft } from "../../devices/deviceImageComposer";
import { clearComposerDraft, getComposerAttachments } from "../model/draftCache";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

const image: DeviceImageDraft = {
  device: {
    id: "sim",
    name: "iPhone",
    platform: "ios",
    version: "27",
    booted: true,
    physical: false,
  },
  computer: { label: "MacBook", target: { kind: "machine", machineId: "mac" } },
  frame: {
    mime: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
    capturedAt: "2026-10-26T10:00:00Z",
  },
  comment: "Make the marked control easier to read",
};

it("preserves the current draft and adds an image, its comment and device context without submitting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const submit = vi.fn();
  clearComposerDraft("device-image-session");
  try {
    await act(async () =>
      root.render(
        createElement(Composer, {
          sessionId: "device-image-session",
          cwd: "/project",
          executionCwd: "/project",
          focused: false,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          hideTopBar: true,
          initialDraft: "Please adjust this",
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: submit,
        }),
      ),
    );
    await act(async () => attachDeviceImage("/project", "device-image-session", image));
    const text = container.querySelector("textarea")!.value;
    expect(text).toMatch(/^Please adjust this\n\n\[image1\]/);
    expect(text).toContain(image.comment);
    expect(text).toContain('"name":"iPhone"');
    expect(text).toContain('"machineId":"mac"');
    expect(getComposerAttachments("device-image-session")).toEqual([
      expect.objectContaining({
        name: "device-screen.png",
        kind: "image",
        data: image.frame.base64,
      }),
    ]);
    expect(submit).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        createElement(Composer, {
          sessionId: "device-image-session",
          cwd: "/project",
          executionCwd: "/project",
          focused: false,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          hideTopBar: true,
          disabled: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: submit,
        }),
      ),
    );
    expect(() => attachDeviceImage("/project", "device-image-session", image)).toThrow(
      "originating conversation",
    );
    expect(container.querySelector("textarea")!.value).toBe(text);
    await act(async () => root.unmount());
  } finally {
    container.remove();
    clearComposerDraft("device-image-session");
    vi.unstubAllGlobals();
  }
});
