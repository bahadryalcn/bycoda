// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InlineVisual } from "./InlineVisual";
import { SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("../../files/ui/HtmlPreview", () => ({
  HtmlPreview: ({
    path,
    source,
    active,
    toolbar,
    sourceVisible,
    originalSource,
  }: {
    path: string;
    source: string;
    active: boolean;
    toolbar: React.ReactNode;
    sourceVisible: boolean;
    originalSource: string;
  }) =>
    active
      ? createElement(
          "div",
          { "data-preview-path": path, "data-preview-source": source },
          toolbar,
          sourceVisible ? createElement("pre", {}, originalSource) : null,
        )
      : null,
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({
    title,
    children,
    onClose,
  }: {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
  }) =>
    createElement(
      "div",
      { role: "dialog", "aria-label": title },
      children,
      createElement("button", { onClick: onClose }, "Close"),
    ),
}));

it("keeps one active preview, immutable source recovery, theme updates and bounded expansion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const snapshot = {
    version: 1 as const,
    title: "Counter",
    html: "<button>Count</button>",
    height: 360,
  };
  const click = async (label: string) => {
    const button = Array.from(document.body.querySelectorAll("button")).find(
      (item) => item.getAttribute("aria-label") === label || item.textContent === label,
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  try {
    document.documentElement.classList.add("theme-light");
    await act(async () => root.render(createElement(InlineVisual, { snapshot })));
    expect(host.querySelectorAll("[data-preview-path]")).toHaveLength(1);
    const preview = () =>
      host.querySelector("[data-preview-source]")!.getAttribute("data-preview-source")!;
    expect(preview()).toContain('content="light"');
    expect(preview()).toContain("connect-src 'none'");
    expect(host.querySelector("[data-preview-path]")!.getAttribute("data-preview-path")).toBe(
      "remote://inline-visual/snapshot.html",
    );
    await act(async () => {
      document.documentElement.classList.remove("theme-light");
      window.dispatchEvent(new Event(SCHEME_CHANGE_EVENT));
    });
    expect(preview()).toContain('content="dark"');
    for (const label of ["Source", "Open in panel", "Expand"]) {
      const action = host.querySelector(`button[aria-label="${label}"]`)!;
      expect(action).toBeTruthy();
      expect(action.querySelector("svg")).toBeTruthy();
      expect(action.textContent).not.toContain(label);
    }
    const inlinePreview = host.querySelector("[data-preview-path]");
    await click("Source");
    expect(host.querySelector("pre")!.textContent).toBe(snapshot.html);
    expect(host.querySelector("[data-preview-path]")).toBe(inlinePreview);
    expect(host.querySelector('button[aria-label="Source"]')!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    await click("Source");
    await click("Open in panel");
    const panel = document.querySelector('[role="dialog"][data-sheet-side="end"]')!;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("aria-label")).toBe(snapshot.title);
    expect(panel.getAttribute("aria-modal")).not.toBe("true");
    expect(document.activeElement).toBe(panel);
    expect(document.querySelectorAll("[data-preview-path]")).toHaveLength(1);
    expect(panel.querySelector("[data-preview-path]")).toBeTruthy();
    expect(host.querySelector("[data-preview-path]")).toBeNull();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[data-sheet-side="end"]')).toBeNull();
    expect(host.querySelectorAll("[data-preview-path]")).toHaveLength(1);
    await click("Expand");
    expect(host.querySelectorAll("[data-preview-path]")).toHaveLength(1);
    expect(host.querySelector('[role="dialog"] [data-preview-path]')).toBeTruthy();
    await click("Close");
    await click("Source");
    expect(host.querySelector("pre")!.textContent).toBe(snapshot.html);
    expect(host.querySelectorAll("[data-preview-path]")).toHaveLength(1);
    await click("Source");
    expect(host.querySelectorAll("[data-preview-path]")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    document.documentElement.classList.remove("theme-light");
    vi.unstubAllGlobals();
  }
});

it("resolves a stored reference by id, keeps transcript title and height, and retries a failed read", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = {
    version: 2 as const,
    id: "b".repeat(64),
    title: "Crew",
    height: 900,
  };
  let fail = true;
  invoke.mockImplementation(async (command: string, args: { id: string }) => {
    expect(command).toBe("inline_visual_read");
    expect(args).toEqual({ id: ref.id });
    if (fail) throw new Error("Visual is not stored on this machine");
    return JSON.stringify({
      version: 1,
      title: "Stored",
      html: "<p>Neo</p>",
      height: 200,
    });
  });
  try {
    await act(async () => root.render(createElement(InlineVisual, { snapshot: ref })));
    expect(host.querySelector("[data-preview-path]")).toBeNull();
    expect(host.textContent).toContain("Preview unavailable");
    fail = false;
    const retry = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Retry"),
    );
    expect(retry).toBeTruthy();
    await act(async () => retry!.click());
    const preview = host.querySelector("[data-preview-source]")!;
    expect(preview.getAttribute("data-preview-source")).toContain("<p>Neo</p>");
    expect(host.querySelector('section[aria-label="Crew"]')).toBeTruthy();
    expect(
      (preview.parentElement as HTMLElement).style.getPropertyValue("--inline-visual-height"),
    ).toBe("900px");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    invoke.mockReset();
    vi.unstubAllGlobals();
  }
});
