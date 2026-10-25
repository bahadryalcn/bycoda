// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../model/backgroundSession", () => ({ loadBackgroundSessionSummary: vi.fn() }));
import { loadBackgroundSessionSummary } from "../model/backgroundSession";
import { BackgroundSessionDialog } from "./BackgroundSessionDialog";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadBackgroundSessionSummary).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const summary = { title: "Session", status: "completed", reply: "First session reply", note: "" };
const render = async (sessionId: string) => {
  await act(async () =>
    root.render(
      createElement(BackgroundSessionDialog, {
        target: { machineId: "machine", sessionId },
        onClose: () => {},
      }),
    ),
  );
};
it("clears the previous session reply immediately while the next session loads", async () => {
  vi.mocked(loadBackgroundSessionSummary)
    .mockResolvedValueOnce(summary)
    .mockReturnValueOnce(new Promise(() => {}));
  await render("first");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("First session reply");
  await render("second");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
    "First session reply",
  );
  expect(document.querySelector('[role="status"]')).not.toBeNull();
});
it("retries a failed read without closing the dialog", async () => {
  let release!: (value: typeof summary) => void;
  vi.mocked(loadBackgroundSessionSummary)
    .mockRejectedValueOnce(new Error("offline"))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
  await render("first");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("offline");
  const retry = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Retry",
  )!;
  retry.focus();
  await act(async () => retry.click());
  expect(retry.isConnected).toBe(true);
  expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(retry);
  await act(async () => retry.click());
  expect(loadBackgroundSessionSummary).toHaveBeenCalledTimes(2);
  await act(async () => release(summary));
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("First session reply");
});

it("inherits the shared modal's default-press prevention when restoring focus", async () => {
  vi.mocked(loadBackgroundSessionSummary).mockResolvedValue(summary);
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const onClose = vi.fn(() => root.render(null));
  try {
    await act(async () =>
      root.render(
        createElement(BackgroundSessionDialog, {
          target: { machineId: "machine", sessionId: "first" },
          onClose,
        }),
      ),
    );
    const surface = document.querySelector(".modal-backdrop")!.parentElement!;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      surface.dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
  }
});
