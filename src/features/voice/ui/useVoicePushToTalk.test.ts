// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useVoicePushToTalk } from "./useVoicePushToTalk";
vi.mock("../../settings/model/useKeybindingShortcut", () => ({
  useKeybindingShortcut: () => "Ctrl+Space",
}));
vi.mock("../../settings/model/settings", () => ({
  keybindingPressed: (_: string, event: KeyboardEvent) => event.ctrlKey && event.code === "Space",
}));
it("requires enabled owner hold, ignores repeats/editors, releases once and cancels on blur", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const begin = vi.fn(() => true),
    end = vi.fn(),
    cancel = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture({ enabled }: { enabled: boolean }) {
    useVoicePushToTalk({ enabled, begin, end, cancel });
    return createElement("input");
  }
  const key = (type: string, target: EventTarget = window, extra = {}) =>
    target.dispatchEvent(
      new KeyboardEvent(type, {
        code: "Space",
        key: " ",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  await act(async () => root.render(createElement(Fixture, { enabled: false })));
  key("keydown");
  expect(begin).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(Fixture, { enabled: true })));
  key("keydown", container.querySelector("input")!);
  expect(begin).not.toHaveBeenCalled();
  key("keydown", window, { isComposing: true });
  expect(begin).not.toHaveBeenCalled();
  key("keydown");
  key("keydown", window, { repeat: true });
  expect(begin).toHaveBeenCalledOnce();
  key("keyup");
  key("keyup");
  expect(end).toHaveBeenCalledOnce();
  key("keydown");
  window.dispatchEvent(new Event("blur"));
  expect(cancel).toHaveBeenCalledOnce();
  key("keyup");
  expect(end).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
