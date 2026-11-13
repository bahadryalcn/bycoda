// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FileTypeIcon } from "./FileTypeIcon";

const pack = vi.hoisted(() => ({ attempt: vi.fn() }));
vi.mock("react-material-icon-theme", () => {
  pack.attempt();
  throw new Error("Icon chunk unavailable");
});

it("keeps decorative icon space when its optional pack fails, without repeated loads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement(FileTypeIcon, { name: "long-name.ts", isDir: false, size: 24 })),
    );
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
    const placeholder = host.firstElementChild as HTMLElement;
    expect(placeholder.getAttribute("aria-hidden")).toBe("true");
    expect(placeholder.style.width).toBe("24px");
    expect(placeholder.style.height).toBe("24px");
    expect(host.querySelector("svg")).toBeNull();
    await act(async () =>
      root.render(createElement(FileTypeIcon, { name: "other.rs", isDir: false, size: 24 })),
    );
    expect(pack.attempt).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(host.firstElementChild).toBe(placeholder);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    warning.mockRestore();
    vi.unstubAllGlobals();
  }
});
