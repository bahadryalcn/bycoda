// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceTurnControl } from "./VoiceTurnControl";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(manual: boolean, muted = false) {
  const onManualChange = vi.fn(),
    onFinish = vi.fn();
  await act(async () =>
    root.render(createElement(VoiceTurnControl, { manual, muted, onManualChange, onFinish })),
  );
  return { onManualChange, onFinish };
}
it("shows the current automatic mode and opens choices without changing or committing audio", async () => {
  const automatic = await render(false);
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  expect(trigger.textContent).toBe("Reply when I pause");
  await act(async () => trigger.click());
  expect(automatic.onManualChange).not.toHaveBeenCalled();
  expect(automatic.onFinish).not.toHaveBeenCalled();
  const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  expect(choices.map((node) => [node.textContent, node.getAttribute("aria-checked")])).toEqual([
    ["I'll finish when ready", "false"],
    ["Reply when I pause", "true"],
  ]);
  await act(async () => choices[0].click());
  expect(automatic.onManualChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(automatic.onFinish).not.toHaveBeenCalled();
  const manual = await render(true);
  const finish = container.querySelector<HTMLButtonElement>('button[aria-label="Finish turn"]')!;
  expect(finish.textContent).toBe("");
  await act(async () => finish.click());
  expect(manual.onFinish).toHaveBeenCalledOnce();
  expect(manual.onManualChange).not.toHaveBeenCalled();
});
it("blocks finishing while muted but keeps the turn policy choice available", async () => {
  const { onFinish, onManualChange } = await render(true, true);
  expect(
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Finish turn"]')!
      .getAttribute("aria-disabled"),
  ).toBe("true");
  const menu = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  expect(menu.disabled).toBe(false);
  await act(async () => menu.click());
  const automatic = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ].find((node) => node.textContent?.includes("Reply when I pause"))!;
  await act(async () => automatic.click());
  expect(onManualChange).toHaveBeenCalledExactlyOnceWith(false);
  expect(onFinish).not.toHaveBeenCalled();
});
