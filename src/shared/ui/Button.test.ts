// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Button, type ButtonProps } from "./Button";
import { SecondaryButton } from "./SecondaryButton";

it("preserves legacy danger and error aliases while letting explicit intent win", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    const cases: [ButtonProps, string, string][] = [
      [{ variant: "primary" }, "primary", "neutral"],
      [{ variant: "danger" }, "secondary", "danger"],
      [{ variant: "danger", tone: "info" }, "secondary", "info"],
      [{ variant: "ghost", tone: "error" }, "ghost", "danger"],
      [{ variant: "tab", tone: "warning", selected: true }, "tab", "warning"],
    ];
    for (const [props, hierarchy, tone] of cases) {
      await act(async () =>
        root.render(createElement(Button, { ...props, motion: "none" }, "Action")),
      );
      const button = container.querySelector("button")!;
      expect(button.dataset.buttonHierarchy).toBe(hierarchy);
      expect(button.dataset.buttonTone).toBe(tone);
      expect(button.hasAttribute("tone")).toBe(false);
    }
    await act(async () =>
      root.render(
        createElement(
          SecondaryButton,
          { danger: true, tone: "warning", motion: "none" },
          "Review deletion",
        ),
      ),
    );
    expect(container.querySelector("button")!.dataset.buttonTone).toBe("warning");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps a toned submit action focusable and prevents duplicate submissions until its owner clears pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLButtonElement>();
  const click = vi.fn();
  const submit = vi.fn((event: Event) => event.preventDefault());
  const render = (loading: boolean) =>
    createElement(
      "form",
      { onSubmit: submit },
      createElement(
        Button,
        {
          ref,
          type: "submit",
          variant: "primary",
          tone: "danger",
          motion: "none",
          loading,
          loadingLabel: "Deleting connection",
          onClick: click,
        },
        "Delete connection",
      ),
    );
  try {
    await act(async () => root.render(render(true)));
    ref.current!.focus();
    await act(async () => {
      ref.current!.click();
      ref.current!.click();
    });
    expect(click).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ref.current);
    expect(ref.current!.getAttribute("aria-label")).toBe("Deleting connection");
    await act(async () => root.render(render(false)));
    await act(async () => ref.current!.click());
    expect(click).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(ref.current);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each(["auto", "none"] as const)(
  "retains focus and blocks duplicate actions when disabled and loading overlap (%s)",
  async (motion) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const click = vi.fn();
    const render = (loading: boolean, disabled: boolean) =>
      createElement(Button, { motion, loading, disabled, onClick: click }, "Refresh");
    try {
      await act(async () => root.render(render(false, false)));
      const button = container.querySelector("button")!;
      button.focus();
      await act(async () => root.render(render(true, true)));
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(button);
      await act(async () => button.click());
      expect(click).not.toHaveBeenCalled();
      await act(async () => root.render(render(false, true)));
      expect(button.disabled).toBe(true);
      await act(async () => root.render(render(false, false)));
      await act(async () => button.click());
      expect(click).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
