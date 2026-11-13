// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionTaskLinkDialog } from "./SessionTaskLinkDialog";

const tasks = [
  { id: "alpha", title: "Alpha task" },
  { id: "beta", title: "Beta task" },
];
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  )!;
const picker = () => document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
async function choose(label: string) {
  await act(async () => picker().click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes(label),
  )!;
  expect(option).toBeDefined();
  await act(async () => option.click());
}

it("owns the submitted selection and blocks Cancel, Close and duplicate requests until failure releases it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let reject!: (cause: Error) => void;
  const request = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const onLink = vi.fn(() => request),
    onClose = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(SessionTaskLinkDialog, {
          sessionTitle: "Session",
          tasks,
          onLink,
          onUnlink: vi.fn(),
          onClose,
        }),
      ),
    );
    await choose("Alpha task");
    await act(async () => {
      button("Link").click();
      button("Link").click();
    });
    expect(onLink).toHaveBeenCalledExactlyOnceWith("alpha");
    expect(picker().disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    expect(button("Close").disabled).toBe(true);
    await act(async () => {
      button("Cancel").click();
      button("Close").click();
      picker().click();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => reject(new Error("Host unavailable")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
    expect(picker().disabled).toBe(false);
    expect(picker().textContent).toContain("Alpha task");
    expect(button("Cancel").disabled).toBe(false);
    expect(button("Close").disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("does not let an old unmounted request close a newly opened dialog or erase its new selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let finish!: () => void;
  const request = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const oldClose = vi.fn(),
    newClose = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(SessionTaskLinkDialog, {
          key: "old",
          sessionTitle: "Old session",
          tasks,
          onLink: () => request,
          onUnlink: vi.fn(),
          onClose: oldClose,
        }),
      ),
    );
    await choose("Alpha task");
    await act(async () => button("Link").click());
    await act(async () =>
      root.render(
        createElement(SessionTaskLinkDialog, {
          key: "new",
          sessionTitle: "New session",
          tasks,
          onLink: vi.fn(),
          onUnlink: vi.fn(),
          onClose: newClose,
        }),
      ),
    );
    await choose("Beta task");
    await act(async () => {
      finish();
      await request;
    });
    expect(oldClose).not.toHaveBeenCalled();
    expect(newClose).not.toHaveBeenCalled();
    expect(picker().textContent).toContain("Beta task");
    expect(button("Link").getAttribute("aria-disabled")).not.toBe("true");
  } finally {
    finish();
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
