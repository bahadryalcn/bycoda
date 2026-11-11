// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MESSAGE_ACTION_CONFIRM_MS, TurnOutputActions } from "./TranscriptMessageActions";

const copyMessage = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>());
const playCue = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/clipboard", () => ({ copyMessage }));
vi.mock("../../settings/model/sounds", () => ({ playCue }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  copyMessage.mockReset();
  playCue.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (props: Parameters<typeof TurnOutputActions>[0]) =>
  act(() => root.render(createElement(TurnOutputActions, props)));
const button = (name: string) =>
  container.querySelector<HTMLButtonElement>(`[data-fbg-item][aria-label="${name}"]`);
const status = () => container.querySelector('[role="status"]')!.textContent;

it("shows a pending copy, confirms only after the clipboard accepted it, then returns to rest", async () => {
  let finish!: () => void;
  copyMessage.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  render({ getText: () => "Answer" });
  const copy = button("Copy response")!;
  await act(async () => {
    copy.click();
    copy.click();
  });
  expect(copyMessage).toHaveBeenCalledExactlyOnceWith("Answer");
  expect(copy.getAttribute("aria-busy")).toBe("true");
  expect(button("Copied")).toBeNull();
  expect(playCue).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(button("Copied")).toBe(copy);
  expect(copy.getAttribute("data-button-tone")).toBe("success");
  expect(status()).toBe("Copied");
  expect(playCue).toHaveBeenCalledOnce();
  await act(async () => {
    vi.advanceTimersByTime(MESSAGE_ACTION_CONFIRM_MS + 1);
  });
  expect(button("Copy response")).toBe(copy);
  expect(status()).toBe("");
});

it("keeps a failed copy honest: reason, retry label, no confirmation sound", async () => {
  copyMessage.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  render({ getText: () => "Answer" });
  await act(async () => button("Copy response")!.click());
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toBe("Copy failed. Clipboard unavailable");
  const retry = button("Retry copy")!;
  expect(retry.getAttribute("data-button-tone")).toBe("danger");
  expect(button("Copied")).toBeNull();
  expect(status()).toBe("");
  expect(playCue).not.toHaveBeenCalled();
  // The error stays until the user retries; time does not clear it.
  await act(async () => {
    vi.advanceTimersByTime(MESSAGE_ACTION_CONFIRM_MS * 5);
  });
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  copyMessage.mockResolvedValueOnce();
  await act(async () => retry.click());
  expect(copyMessage).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button("Copied")).toBe(retry);
});

it("saves to Notes only after persistence settles and keeps copy independent", async () => {
  let fail!: (reason: Error) => void;
  const onSave = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)));
  render({ getText: () => "Answer", onSave });
  const save = button("Save as note")!;
  await act(async () => {
    save.click();
    save.click();
  });
  expect(onSave).toHaveBeenCalledExactlyOnceWith("Answer");
  expect(save.getAttribute("aria-busy")).toBe("true");
  expect(button("Copy response")!.getAttribute("aria-busy")).toBeNull();
  await act(async () => fail(new Error("Storage unavailable")));
  expect(button("Saved to Notes")).toBeNull();
  expect(button("Retry save")).toBe(save);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not save note. Storage unavailable",
  );
});

it("drops an outcome that belongs to replaced text and ignores its late result", async () => {
  let finish!: () => void;
  copyMessage.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  render({ getText: () => "First" });
  await act(async () => button("Copy response")!.click());
  render({ getText: () => "Second" });
  await act(async () => finish());
  expect(button("Copied")).toBeNull();
  expect(button("Copy response")!.getAttribute("aria-busy")).toBeNull();
});

it("renders nothing without text or extra actions, and extra actions alone still render", () => {
  render({});
  expect(container.querySelector('[role="toolbar"]')).toBeNull();
  render({ extraItems: [{ id: "extra", label: "Turn metrics", icon: createElement("span") }] });
  expect(container.querySelectorAll("[data-fbg-item]")).toHaveLength(1);
});
