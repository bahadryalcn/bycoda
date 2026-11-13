// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SubagentModeControl } from "./SubagentModeControl";

it("shows the wire mode and emits mode choices without persisting Custom", () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const change = vi.fn();
  const custom = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() =>
    root.render(
      createElement(SubagentModeControl, {
        label: "Subagents",
        value: undefined,
        onChange: change,
        onCustom: custom,
      }),
    ),
  );
  const radio = (name: string) =>
    [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (item) => item.textContent === name,
    )!;
  expect(radio("Automatic").getAttribute("aria-checked")).toBe("true");
  act(() => radio("Custom").click());
  expect(custom).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
  act(() => radio("Off").click());
  expect(change).toHaveBeenCalledWith("[]");
  act(() =>
    root.render(
      createElement(SubagentModeControl, {
        label: "Subagents",
        value: "[]",
        disabled: true,
        onChange: change,
        onCustom: custom,
      }),
    ),
  );
  expect(radio("Off").getAttribute("aria-checked")).toBe("true");
  expect(radio("Automatic").disabled).toBe(true);
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});
