// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

const copyText = vi.hoisted(() => vi.fn(async (_text: string) => {}));
vi.mock("../../platform/tauri/clipboard", () => ({ copyText }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  copyText.mockReset();
  copyText.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const button = () => host.querySelector<HTMLButtonElement>("button")!;

it("turns the icon into a success check after the write settles, then back", async () => {
  vi.useFakeTimers();
  await act(async () =>
    root.render(createElement(CopyButton, { iconOnly: true, label: "Copy path", text: "C:/a" })),
  );
  expect(button().getAttribute("aria-label")).toBe("Copy path");
  await act(async () => button().click());
  expect(copyText).toHaveBeenCalledWith("C:/a");
  expect(button().dataset.copyState).toBe("copied");
  expect(button().getAttribute("aria-label")).toBe("Copied");
  expect(button().querySelector('[data-tone="success"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(button().dataset.copyState).toBeUndefined();
  expect(button().getAttribute("aria-label")).toBe("Copy path");
});

it("keeps a failure visible and reports it until the next press", async () => {
  copyText.mockRejectedValueOnce(new Error("denied"));
  const onCopyError = vi.fn();
  await act(async () =>
    root.render(createElement(CopyButton, { label: "Copy", text: "npx skills", onCopyError })),
  );
  await act(async () => button().click());
  expect(onCopyError).toHaveBeenCalledWith(expect.objectContaining({ message: "denied" }));
  expect(button().dataset.copyState).toBe("failed");
  expect(button().textContent).toContain("Copy failed. Try again.");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Copy failed. Try again.");
  await act(async () => button().click());
  expect(button().dataset.copyState).toBe("copied");
  expect(button().textContent).toContain("Copied");
});

it.each([true, false])(
  "keeps copy feedback in one compact alert (icon only: %s)",
  async (iconOnly) => {
    const detail =
      "The request is not allowed by the user agent or the platform in the current context.";
    copyText.mockRejectedValueOnce(new DOMException(detail, "NotAllowedError"));
    await act(async () =>
      root.render(
        createElement(CopyButton, {
          iconOnly,
          label: "Copy message",
          text: "message",
          errorDetail: true,
        }),
      ),
    );
    const retry = button();
    const copyIcon = retry.querySelector("svg")?.innerHTML;
    await act(async () => retry.click());
    const alert = host.querySelector('[role="alert"]')!;
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(
      [...alert.querySelectorAll("svg")].filter((icon) => !icon.closest("button")),
    ).toHaveLength(1);
    expect(alert.textContent).toContain("Copy failed. Try again.");
    expect(alert.textContent).not.toContain(detail);
    expect(retry.querySelector("svg")?.innerHTML).toBe(copyIcon);
    expect(retry.getAttribute("aria-label")).toBe("Copy message");
    await act(async () => alert.querySelector("button")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(detail);
    await act(async () => retry.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(retry.dataset.copyState).toBe("copied");
  },
);

it("uses a custom clipboard write and reads lazy text at click time", async () => {
  const onCopy = vi.fn(async () => {});
  await act(async () => root.render(createElement(CopyButton, { label: "Copy", onCopy })));
  await act(async () => button().click());
  expect(onCopy).toHaveBeenCalledOnce();
  expect(copyText).not.toHaveBeenCalled();

  let value = "first";
  await act(async () =>
    root.render(createElement(CopyButton, { label: "Copy", text: () => value })),
  );
  value = "second";
  await act(async () => button().click());
  expect(copyText).toHaveBeenLastCalledWith("second");
});
