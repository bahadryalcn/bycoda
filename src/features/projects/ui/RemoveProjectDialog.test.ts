// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 2),
}));
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import { Modal } from "../../../shared/ui/Modal";
import { projectSessionCount } from "../model/projectData";

it("silme penceresinin Cancel odağını korur ve üst pencere Escape'i sahiplenir", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const trigger = document.createElement("button");
  const container = document.createElement("div");
  document.body.append(trigger, container);
  trigger.focus();
  const root = createRoot(container);
  const cancel = vi.fn();
  const childCancel = vi.fn();
  const confirm = vi.fn();
  const dialog = () =>
    createElement(RemoveProjectDialog, {
      name: "Repo",
      path: "/repo",
      onCancel: cancel,
      onConfirm: confirm,
    });
  const escape = () =>
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  try {
    await act(async () => root.render(dialog()));
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(trigger.inert).toBe(true);
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          dialog(),
          createElement(Modal, {
            title: "Top",
            onClose: childCancel,
            children: "top",
          }),
        ),
      ),
    );
    escape();
    expect(childCancel).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => root.render(dialog()));
    escape();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    expect(trigger.inert).toBe(false);
    container.remove();
    trigger.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps a failed deletion open and prevents dismissal while it is pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(projectSessionCount).mockResolvedValue(2);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const cancel = vi.fn();
  let fail!: (reason: unknown) => void;
  const confirm = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  try {
    await act(async () =>
      root.render(
        createElement(RemoveProjectDialog, {
          name: "Repo",
          path: "/repo",
          onCancel: cancel,
          onConfirm: confirm,
        }),
      ),
    );
    const button = (label: string) =>
      Array.from(document.querySelectorAll("button")).find(
        (item) => item.getAttribute("aria-label") === label || item.textContent === label,
      )!;
    await act(async () => button("Delete").click());
    expect(document.querySelector('[role="dialog"] [aria-busy="true"]')).not.toBeNull();
    expect(button("Cancel").disabled).toBe(true);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => fail(new Error("Could not delete conversation")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not delete conversation",
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("Delete").disabled).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("blocks deletion when the conversation count failed and offers a read retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(projectSessionCount)
    .mockRejectedValueOnce(new Error("Cannot read conversations"))
    .mockResolvedValue(3);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(RemoveProjectDialog, {
          name: "Repo",
          path: "/repo",
          onCancel: vi.fn(),
          onConfirm: vi.fn(),
        }),
      ),
    );
    const button = (label: string) =>
      Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label)!;
    expect(button("Delete").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Cannot read conversations",
    );
    await act(async () => button("Retry").click());
    expect(button("Delete").disabled).toBe(false);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "3 saved conversations",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("prevents a dismissed backdrop's default press from stealing restored focus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(projectSessionCount).mockResolvedValue(0);
  const trigger = document.createElement("button");
  const container = document.createElement("div");
  document.body.append(trigger, container);
  trigger.focus();
  const root = createRoot(container);
  const cancel = vi.fn(() => root.render(null));
  try {
    await act(async () =>
      root.render(
        createElement(RemoveProjectDialog, {
          name: "Repo",
          path: "/repo",
          onCancel: cancel,
          onConfirm: vi.fn(),
        }),
      ),
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      dialog.parentElement!.parentElement!.dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => root.unmount());
    trigger.remove();
    container.remove();
    vi.unstubAllGlobals();
  }
});
