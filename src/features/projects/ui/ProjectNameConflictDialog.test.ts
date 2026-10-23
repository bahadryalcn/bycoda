// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectNameConflictDialog } from "./ProjectNameConflictDialog";

it("prevents backdrop mousedown from clearing the restored trigger focus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const trigger = document.createElement("button");
  const container = document.createElement("div");
  document.body.append(trigger, container);
  trigger.focus();
  const root = createRoot(container);
  const cancel = vi.fn(() => root.render(null));
  try {
    await act(async () =>
      root.render(
        createElement(ProjectNameConflictDialog, {
          name: "Repo",
          path: "/repo",
          suggested: "Repo 2",
          validate: () => null,
          onConfirm: vi.fn(),
          onCancel: cancel,
        }),
      ),
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const inputPress = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      dialog.querySelector("input")!.dispatchEvent(inputPress);
    });
    expect(inputPress.defaultPrevented).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    const backdropPress = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      dialog.parentElement!.parentElement!.dispatchEvent(backdropPress);
    });
    expect(backdropPress.defaultPrevented).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => root.unmount());
    trigger.remove();
    container.remove();
    vi.unstubAllGlobals();
  }
});
