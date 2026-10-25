// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Window } from "happy-dom";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";
import { HtmlPreview } from "./HtmlPreview";

const { invoke, convertFileSrc, urlFormat } = vi.hoisted(() => {
  const urlFormat = { value: "windows-http" };
  return {
    invoke: vi.fn(),
    urlFormat,
    // Tauri encodes the whole path, including '/', with OS-specific URL forms.
    convertFileSrc: vi.fn((path: string, protocol: string) => {
      const encodedPath = encodeURIComponent(path);
      if (urlFormat.value === "mac-scheme") return `${protocol}://localhost/${encodedPath}`;
      const scheme = urlFormat.value === "windows-https" ? "https" : "http";
      return `${scheme}://${protocol}.localhost/${encodedPath}`;
    }),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc }));

it("retains reload after failure and prevents duplicate preview creation while retrying", async () => {
  (window as unknown as Window).happyDOM.settings.navigation.disableChildFrameNavigation = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (token: string) => void;
  invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "create_html_preview") throw new Error("Preview service unavailable");
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(HtmlPreview, {
          path: "example.html",
          source: "<p>Draft preview</p>",
          active: true,
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Preview service unavailable",
    );
    const reload = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reload preview",
    )!;
    expect(reload).toBeDefined();
    invoke.mockImplementation(async (command: string) =>
      command === "create_html_preview"
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    reload.focus();
    await act(async () => {
      reload.click();
      reload.click();
    });
    expect(invoke.mock.calls.filter(([command]) => command === "create_html_preview")).toHaveLength(
      2,
    );
    expect(reload.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(reload);
    await act(async () => finish("retry-token"));
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms",
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([
  { label: "Windows HTTP", format: "windows-http", base: "http://html-preview.localhost" },
  { label: "Windows HTTPS", format: "windows-https", base: "https://html-preview.localhost" },
  { label: "macOS custom scheme", format: "mac-scheme", base: "html-preview://localhost" },
])(
  "accepts selection in the current sandbox under $label and requires a click to add to chat",
  async ({ format, base }) => {
    const settings = (window as unknown as Window).happyDOM.settings;
    settings.navigation.disableChildFrameNavigation = true;
    urlFormat.value = format;
    invoke.mockReset();
    convertFileSrc.mockClear();
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
      expect(convertFileSrc).toHaveBeenCalledWith("preview-token", "html-preview");
      expect(frame.src).toBe(`${base}/preview-token/index.html`);
      expect(new URL(frame.src).pathname).toBe("/preview-token/index.html");
      expect(new URL("style.css", frame.src).pathname).toBe("/preview-token/style.css");
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
          createElement(HtmlPreview, {
            path: "example.html",
            source: "<p>Hello</p>",
            active: false,
          }),
        ),
      );
      expect(document.querySelector('[role="toolbar"]')).toBeNull();
      expect(invoke).toHaveBeenCalledWith("close_html_preview", { token: "preview-token" });
    } finally {
      await act(async () => root.unmount());
      window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
      container.remove();
      settings.navigation.disableChildFrameNavigation = false;
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
