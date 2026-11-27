// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pendingSources, type PendingChange } from "./pendingChanges";
import { SettingsSaveBar, type SettingsSaveBarProps } from "./SettingsSaveBar";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (name: string) =>
  buttons().find(
    (el) => el.textContent?.trim() === name || el.getAttribute("aria-label") === name,
  )!;
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

async function render(changes: PendingChange[], props: Partial<SettingsSaveBarProps> = {}) {
  const onSave = vi.fn<() => boolean>(() => true);
  const onDiscard = vi.fn();
  await act(async () =>
    root.render(
      createElement(SettingsSaveBar, {
        id: "bar",
        title: "Bar",
        changes,
        pending: false,
        saved: false,
        onSave,
        onDiscard,
        ...props,
      }),
    ),
  );
  return { onSave, onDiscard };
}

it("counts the changes, with the singular for one", async () => {
  await render([{ id: "a", label: "Effort" }]);
  expect(button("1 unsaved change")).toBeDefined();
  await render([
    { id: "a", label: "Effort" },
    { id: "b", label: "Model" },
  ]);
  expect(button("2 unsaved changes")).toBeDefined();
});

it("shows no count and disables Save and Discard while clean", async () => {
  await render([]);
  expect(container.textContent).not.toContain("unsaved");
  expect(button("Save").disabled).toBe(true);
  expect(button("Discard").disabled).toBe(true);
});

it("lists the changes grouped by scope with their details, and reverts one", async () => {
  const revert = vi.fn();
  await render([
    { id: "a", label: "Effort", scope: "Claude · Work", detail: "Medium → High", revert },
    { id: "b", label: "Model", scope: "Codex" },
    { id: "c", label: "Subagents", scope: "Claude · Work" },
  ]);
  await click(button("3 unsaved changes"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute("aria-label")).toBe("Unsaved changes");
  const text = dialog.textContent!;
  expect(text.indexOf("Claude · Work")).toBeLessThan(text.indexOf("Codex"));
  expect(text.split("Claude · Work")).toHaveLength(2);
  expect(text).toContain("Medium → High");
  // Only a change that can revert alone offers Undo.
  expect(dialog.querySelectorAll('button[aria-label^="Undo"]')).toHaveLength(1);
  await click(button("Undo Effort"));
  expect(revert).toHaveBeenCalledOnce();
});

it("runs save and discard and honours canSave and discardEnabled", async () => {
  const { onSave, onDiscard } = await render([{ id: "a", label: "Effort" }]);
  await click(button("Save"));
  await click(button("Discard"));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onDiscard).toHaveBeenCalledOnce();
  await render([{ id: "a", label: "Effort" }], { canSave: false, discardLabel: "Reload" });
  expect(button("Save").disabled).toBe(true);
  expect(button("Reload").disabled).toBe(false);
  await render([], { discardEnabled: true, discardLabel: "Reload" });
  expect(button("Reload").disabled).toBe(false);
});

it("registers the draft for the leave guard only while it has changes", async () => {
  await render([{ id: "a", label: "Effort" }], { title: "Background work" });
  expect(pendingSources().map((source) => [source.id, source.title, source.canSave])).toEqual([
    ["bar", "Background work", true],
  ]);
  await render([{ id: "a", label: "Effort" }], { pending: true });
  expect(pendingSources()[0]!.canSave).toBe(false);
  await render([]);
  expect(pendingSources()).toEqual([]);
  await render([{ id: "a", label: "Effort" }]);
  await act(async () => root.unmount());
  expect(pendingSources()).toEqual([]);
  root = createRoot(container);
});

it("shows the saved label only once the draft is clean", async () => {
  await render([], { saved: true, successLabel: "Saved to Global" });
  expect(button("Saved to Global")).toBeDefined();
  await render([{ id: "a", label: "Effort" }], { saved: true });
  expect(buttons().some((el) => el.textContent?.trim() === "Saved")).toBe(false);
});

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

it("catches a rejected save, keeps the draft, Save and its focus, and Retry saves again", async () => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  try {
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(true);
    await render([{ id: "a", label: "Effort" }], { onSave });
    const save = button("Save");
    save.focus();
    await click(save);
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Could not save changes");
    // The raw text sits behind Details, never in the banner.
    expect(alert.textContent).not.toContain("disk full");
    expect(button("1 unsaved change")).toBeDefined();
    expect(pendingSources().map((source) => [source.id, source.canSave])).toEqual([["bar", true]]);
    expect(button("Save").disabled).toBe(false);
    expect(document.activeElement).toBe(save);
    // Retry from the notice; when it succeeds the notice goes and focus lands on Save.
    const retry = button("Retry");
    retry.focus();
    await click(retry);
    await settle();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(save);
  } finally {
    process.off("unhandledRejection", unhandled);
  }
});

it("resolves a rejected registered save to false for the leave prompt", async () => {
  const onSave = vi.fn<() => Promise<boolean>>().mockRejectedValue(new Error("offline"));
  await render([{ id: "a", label: "Effort" }], { onSave });
  let result: boolean | Promise<boolean> | undefined;
  await act(async () => {
    result = pendingSources()[0]!.save();
    await result;
  });
  expect(result).toBeInstanceOf(Promise);
  expect(await result).toBe(false);
  expect(button("Retry")).toBeDefined();
});

it("clears the failure on Discard and shows none when the editor refuses with false", async () => {
  const onSave = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error("offline"));
  const { onDiscard } = await render([{ id: "a", label: "Effort" }], { onSave });
  await click(button("Save"));
  await settle();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await click(button("Discard"));
  expect(onDiscard).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  onSave.mockResolvedValueOnce(false);
  await click(button("Save"));
  await settle();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("runs one save while another is in flight", async () => {
  let finish!: (saved: boolean) => void;
  const onSave = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
  await render([{ id: "a", label: "Effort" }], { onSave });
  await click(button("Save"));
  await click(button("Saving…"));
  expect(onSave).toHaveBeenCalledOnce();
  expect(pendingSources()[0]!.pending).toBe(true);
  await act(async () => finish(true));
  expect(pendingSources()[0]!.pending).toBe(false);
});
