// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../model/prChecks", () => ({ fetchCheckDetails: vi.fn() }));
import { CheckRepairForm } from "./CheckRepairForm";
import { Modal } from "../../../shared/ui/Modal";

it("repair popover mevcut overlay politikasını korur, üst pencere Escape'i tüketir", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const close = vi.fn();
  const topClose = vi.fn();
  const form = () =>
    createElement(CheckRepairForm, {
      anchor: { x: 10, y: 10 },
      checks: [],
      headOid: "head",
      cwd: "/repo",
      repo: "o/r",
      repair: { number: 1, sessions: [], onStart: vi.fn() },
      onClose: close,
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
    await act(async () => root.render(form()));
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          form(),
          createElement(Modal, {
            title: "Top",
            onClose: topClose,
            children: "top",
          }),
        ),
      ),
    );
    escape();
    expect(topClose).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    await act(async () => root.render(form()));
    escape();
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
