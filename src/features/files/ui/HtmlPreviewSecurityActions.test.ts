// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HtmlPreview } from "./HtmlPreview";

const native = vi.hoisted(() => ({ open: vi.fn(), invoke: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({ openPathWithDefaultApp: native.open }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  convertFileSrc: (id: string) => `http://html-preview.localhost/${id}`,
}));

it("opens a saved file only after explicit action and preserves the live frame on failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.invoke
    .mockReset()
    .mockImplementation(async (method, args) =>
      method === "create_html_preview" ? args.token : undefined,
    );
  native.open.mockReset().mockRejectedValue(new Error("OS opener unavailable"));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(HtmlPreview, {
          path: "/project/example.html",
          source: "<p>Retained source</p>",
          active: true,
        }),
      ),
    );
    const frame = host.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame!.getAttribute("allow")).toContain("microphone 'none'");
    expect(frame!.getAttribute("allow")).toContain("camera 'none'");
    expect(native.open).not.toHaveBeenCalled();
    const action = host.querySelector<HTMLButtonElement>(
      '[aria-label="Open saved file in default app"]',
    );
    expect(action).not.toBeNull();
    await act(async () => {
      action!.click();
    });
    expect(native.open).toHaveBeenCalledExactlyOnceWith("/project/example.html");
    expect(host.querySelector("iframe")).toBe(frame);
    expect(host.textContent).toContain("OS opener unavailable");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("does not offer an external-file action for inline-only content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.invoke
    .mockReset()
    .mockImplementation(async (method, args) =>
      method === "create_html_preview" ? args.token : undefined,
    );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(HtmlPreview, {
          path: "generated-inline.html",
          source: "<p>Inline</p>",
          active: true,
        }),
      ),
    );
    expect(host.querySelector('[aria-label="Open saved file in default app"]')).toBeNull();
    expect(host.querySelector('[aria-label="Preview restrictions"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
