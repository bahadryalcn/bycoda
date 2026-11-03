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
it("switches to manual without committing audio, then exposes an explicit text finish action", async () => {
  const automatic = await render(false);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-split-part="primary"]')!.click(),
  );
  expect(automatic.onManualChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(automatic.onFinish).not.toHaveBeenCalled();
  const manual = await render(true);
  const finish = container.querySelector<HTMLButtonElement>('[data-split-part="primary"]')!;
  expect(finish.textContent).toBe("Finish turn");
  await act(async () => finish.click());
  expect(manual.onFinish).toHaveBeenCalledOnce();
  expect(manual.onManualChange).not.toHaveBeenCalled();
});
it("blocks finishing while muted but keeps the turn policy choice available", async () => {
  const { onFinish, onManualChange } = await render(true, true);
  expect(container.querySelector<HTMLButtonElement>('[data-split-part="primary"]')!.disabled).toBe(
    true,
  );
  const menu = container.querySelector<HTMLButtonElement>('[data-split-part="menu"]')!;
  expect(menu.disabled).toBe(false);
  await act(async () => menu.click());
  const automatic = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ].find((node) => node.textContent?.includes("Automatic replies"))!;
  await act(async () => automatic.click());
  expect(onManualChange).toHaveBeenCalledExactlyOnceWith(false);
  expect(onFinish).not.toHaveBeenCalled();
});
