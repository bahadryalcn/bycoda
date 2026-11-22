// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DiagnosticsGroup } from "./DiagnosticsSettings";
const copy = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copy }));
const stallProfiles = vi.hoisted(() => ({
  load: vi.fn(async () => false),
  save: vi.fn(async (enabled: boolean) => enabled),
}));
vi.mock("../model/hostStallProfiles", () => ({
  loadHostStallProfiles: stallProfiles.load,
  saveHostStallProfiles: stallProfiles.save,
}));
it("shows the Host CPU profile switch off by default and stores a change on the Host", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const hostSwitch = () =>
    container.querySelector<HTMLButtonElement>(
      '#host-stall-profiles [role="switch"], [data-setting-id="host-stall-profiles"] [role="switch"]',
    ) ?? [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].at(-1)!;
  try {
    await act(async () => root.render(createElement(DiagnosticsGroup)));
    expect(hostSwitch().getAttribute("aria-checked")).toBe("false");
    await act(async () => hostSwitch().click());
    expect(stallProfiles.save).toHaveBeenCalledWith(true);
    expect(hostSwitch().getAttribute("aria-checked")).toBe("true");
    stallProfiles.save.mockRejectedValueOnce(new Error("Host offline"));
    await act(async () => hostSwitch().click());
    expect(hostSwitch().getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Host offline");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
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
    // Trace data is a sub-row that only works while the trace is on.
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
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
    expect(button.getAttribute("data-copy-state")).toBe("failed");
    expect(button.textContent).toBe("Copy failed. Try again.");
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    await act(async () => button.click());
    expect(copy).toHaveBeenCalledTimes(2);
    expect(button.getAttribute("data-copy-state")).toBe("copied");
    expect(container.textContent).toContain("Copied");
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("shows Cleared after Clear, and a new Copy hides it", async () => {
  copy.mockReset().mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DiagnosticsGroup)));
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
    const named = (label: string) =>
      [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;
    await act(async () => named("Copy trace").click());
    expect(container.textContent).toContain("Copied");
    await act(async () => named("Clear").click());
    expect(container.textContent).toContain("Cleared");
    await act(async () => named("Copied").click());
    expect(container.textContent).not.toContain("Cleared");
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("says so, with a retry, when the trace preference cannot be stored", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // Earlier tests stored the flag, after which the prototype spy no longer reaches the instance.
  const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  try {
    await act(async () => root.render(createElement(DiagnosticsGroup)));
    const toggle = container.querySelector<HTMLElement>('[role="switch"]')!;
    await act(async () => toggle.click());
    expect(container.textContent).toContain("could not be saved");
    setItem.mockRestore();
    const retry = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Retry saving",
    )!;
    await act(async () => retry.click());
    expect(container.textContent).not.toContain("could not be saved");
    // Leave the default (off) behind for other tests.
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
  } finally {
    setItem.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});
