// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";
import { HtmlPreview } from "./HtmlPreview";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: () => "about:blank" }));

it("accepts selection only from the current sandbox and requires a click to add to chat", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockResolvedValue("preview-token");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAdd = vi.fn();
  window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
  try {
    await act(async () =>
      root.render(
        createElement(HtmlPreview, {
          path: "example.html",
          source: "<!doctype html><p>Hello</p>",
          active: true,
        }),
      ),
    );
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 200, 500, 500));
    const content = invoke.mock.calls.find(([action]) => action === "create_html_preview")![1]
      .content as string;
    const channel = JSON.parse(content.match(/const channel=("[^"]+")/)![1]);
    const data = {
      channel,
      selection: { text: "Hello HTML", x: 20, y: 30, width: 60, height: 20 },
    };
    await act(async () =>
      window.dispatchEvent(new MessageEvent("message", { data, source: window })),
    );
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...data, channel: "old-preview" },
          source: frame.contentWindow,
        }),
      ),
    );
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () =>
      window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow })),
    );
    const button = document.querySelector<HTMLButtonElement>('[role="toolbar"] button')!;
    expect(button.textContent).toContain("Add to chat");
    expect(onAdd).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect((onAdd.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: "@example.html\n\nHello HTML",
      mode: "quote",
    });
    await act(async () =>
      root.render(
        createElement(HtmlPreview, { path: "example.html", source: "<p>Hello</p>", active: false }),
      ),
    );
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    expect(invoke).toHaveBeenCalledWith("close_html_preview", { token: "preview-token" });
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
