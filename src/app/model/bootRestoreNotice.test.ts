// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { showBootRestoreNotice } from "./bootRestoreNotice";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.replaceChildren();
});

const buttons = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("button")].filter((button) => button.textContent?.includes(label));

it("asks before Start fresh lets the window save over the unreadable layout", async () => {
  const startFresh = vi.fn();
  await act(async () => showBootRestoreNotice({ canRead: async () => false, startFresh }));
  expect(document.body.textContent).toContain("save over it");

  await act(async () => buttons(document.body, "Start fresh")[0]!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).toContain("cannot be recovered");
  expect(startFresh).not.toHaveBeenCalled();

  await act(async () => buttons(dialog, "Cancel")[0]!.click());
  expect(startFresh).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Could not restore your tabs");

  await act(async () => buttons(document.body, "Start fresh")[0]!.click());
  const again = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () => buttons(again, "Start fresh")[0]!.click());
  expect(startFresh).toHaveBeenCalledTimes(1);
});
