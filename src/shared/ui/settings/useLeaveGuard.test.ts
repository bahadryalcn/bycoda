// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pendingSources, usePendingSource } from "./pendingChanges";
import { useLeaveGuard } from "./useLeaveGuard";

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

function Page({
  save,
  discard,
  leave,
}: {
  save: () => boolean | Promise<boolean>;
  discard: () => void;
  leave: () => void;
}) {
  usePendingSource({
    id: "editor",
    title: "Defaults",
    changes: [{ id: "effort", label: "Effort" }],
    canSave: true,
    save,
    discard,
  });
  const { guard, dialog } = useLeaveGuard();
  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => guard(leave) }, "Leave settings"),
    dialog,
  );
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === name,
  );
const click = (name: string) => act(async () => button(name)!.click());

async function openGuard(save: () => boolean | Promise<boolean>) {
  const discard = vi.fn();
  const leave = vi.fn();
  await act(async () => root.render(createElement(Page, { save, discard, leave })));
  await click("Leave settings");
  return { discard, leave };
}

it("leaves only after the editor acknowledged the save", async () => {
  const save = vi.fn(async () => true);
  const { leave, discard } = await openGuard(save);
  await click("Save and leave");
  await vi.waitFor(() => expect(leave).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
  expect(discard).not.toHaveBeenCalled();
});

it.each([
  ["refuses", async () => false],
  [
    "throws",
    async () => {
      throw new Error("Host unavailable");
    },
  ],
])("stays and keeps the draft when the save %s", async (_name, save) => {
  const { leave, discard } = await openGuard(save);
  await click("Save and leave");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Some changes were not saved."),
  );
  expect(leave).not.toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
  expect(pendingSources().map((source) => source.id)).toEqual(["editor"]);
  // Keep editing closes the prompt without leaving or discarding anything.
  await click("Keep editing");
  expect(button("Save and leave")).toBeUndefined();
  expect(leave).not.toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
  expect(pendingSources().map((source) => source.id)).toEqual(["editor"]);
});

it("does not leave while the save is still unacknowledged, and retries after a refusal", async () => {
  let release!: (acknowledged: boolean) => void;
  let attempts = 0;
  const save = vi.fn(() => {
    attempts += 1;
    return new Promise<boolean>((resolve) => (release = resolve));
  });
  const { leave } = await openGuard(save);
  await click("Save and leave");
  expect(leave).not.toHaveBeenCalled();
  await act(async () => release(false));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Some changes were not saved."),
  );
  expect(leave).not.toHaveBeenCalled();
  await click("Save and leave");
  await act(async () => release(true));
  await vi.waitFor(() => expect(leave).toHaveBeenCalledOnce());
  expect(attempts).toBe(2);
});
