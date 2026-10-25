// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DiagnosticsGroup } from "./DiagnosticsSettings";
const copy = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copy }));
it("keeps copy feedback local, prevents duplicates, and preserves retry after failure", async () => {
  let reject!: (reason: Error) => void;
  copy
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DiagnosticsGroup)));
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Copy trace",
    )!;
    button.focus();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button);
    await act(async () => reject(new Error("Clipboard unavailable")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Clipboard unavailable");
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    await act(async () => button.click());
    expect(copy).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Copied");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
