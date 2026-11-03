// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InlineVisual } from "./InlineVisual";
import { SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";

vi.mock("../../files/ui/HtmlPreview", () => ({
  HtmlPreview: ({ path, source, active }: { path: string; source: string; active: boolean }) =>
    active
      ? createElement("div", { "data-preview-path": path, "data-preview-source": source })
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
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) => item.textContent === label,
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
    await click("Expand");
    expect(host.querySelectorAll("[data-preview-path]")).toHaveLength(1);
    expect(host.querySelector('[role="dialog"] [data-preview-path]')).toBeTruthy();
    await click("Close");
    await click("Source");
    expect(host.querySelector("pre")!.textContent).toBe(snapshot.html);
    expect(host.querySelector("[data-preview-path]")).toBeNull();
    await click("Source");
    expect(host.querySelectorAll("[data-preview-path]")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    document.documentElement.classList.remove("theme-light");
    vi.unstubAllGlobals();
  }
});
