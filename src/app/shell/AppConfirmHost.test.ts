// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmSessionDelete } from "../../features/sessions/model/confirmSessionDelete";
import { confirmInApp } from "../../shared/model/appConfirm";
import { AppConfirmHost } from "./AppConfirmHost";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => true), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(AppConfirmHost)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  mocks.ask.mockReset();
});

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent?.trim() === name,
  );
/** The host waits for the native menu to close before it mounts the dialog. */
async function open(input: Parameters<typeof confirmSessionDelete>[0]) {
  let answer: boolean | undefined;
  const pending = confirmSessionDelete(input).then((value) => (answer = value));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  return { pending, answer: () => answer };
}

describe("app confirmation host", () => {
  it("shows the shared dialog, never the platform dialog, with the target and a danger action", async () => {
    const { pending } = await open({ count: 1, title: "Fix login" });
    expect(mocks.ask).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Delete conversation?");
    expect(dialog.textContent).toContain("“Fix login”");
    expect(button("Delete")?.getAttribute("data-button-tone")).toBe("danger");
    await act(async () => button("Cancel")!.click());
    await pending;
  });
  it("resolves false on Cancel and Escape, true only on Delete", async () => {
    let run = await open({ count: 2 });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Delete 2 conversations?",
    );
    await act(async () => button("Cancel")!.click());
    await run.pending;
    expect(run.answer()).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    run = await open({ count: 2 });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await run.pending;
    expect(run.answer()).toBe(false);

    run = await open({ count: 2 });
    await act(async () => button("Delete 2 conversations")!.click());
    await run.pending;
    expect(run.answer()).toBe(true);
  });
  it("renders a normal-tone request with a primary action and the given target text", async () => {
    let answer: boolean | undefined;
    const pending = confirmInApp({
      title: "Close terminal?",
      message: "“npm run dev” is still running in Terminal 1.",
      confirmLabel: "Close terminal",
      tone: "normal",
    }).then((value) => (answer = value));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(mocks.ask).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Close terminal?");
    expect(dialog.textContent).toContain("“npm run dev” is still running in Terminal 1.");
    expect(button("Close terminal")?.getAttribute("data-button-tone")).not.toBe("danger");
    expect(button("Cancel")).toBeDefined();
    await act(async () => button("Close terminal")!.click());
    await pending;
    expect(answer).toBe(true);
  });
  it("ignores the Enter or Space that opened the menu item, including key repeat", async () => {
    const pending = confirmSessionDelete({ count: 1 });
    // Wait for the dialog, but stay inside the guard window.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    const confirm = button("Delete")!;
    const press = (key: string, repeat = false) => {
      const event = new KeyboardEvent("keydown", { key, repeat, bubbles: true, cancelable: true });
      confirm.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press("Enter")).toBe(true);
    expect(press(" ")).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(press("Enter", true)).toBe(true);
    expect(press("Enter")).toBe(false);
    await act(async () => button("Cancel")!.click());
    expect(await pending).toBe(false);
  });
});
