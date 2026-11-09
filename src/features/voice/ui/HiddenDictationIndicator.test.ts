// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { reportDictation } from "../model/dictationActivity";
import { HiddenDictationIndicator } from "./HiddenDictationIndicator";

it("appears only for dictation whose message box is off screen, and stops it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const onOpenSession = vi.fn();
  await act(async () => root.render(createElement(HiddenDictationIndicator, { onOpenSession })));
  const owner = Symbol();
  const stop = vi.fn();
  await act(async () => reportDictation(owner, { state: "listening", visible: true, stop }));
  expect(element.textContent).toBe("");
  await act(async () =>
    reportDictation(owner, { sessionId: "missing", state: "listening", visible: false, stop }),
  );
  expect(element.textContent).toContain("Dictation is listening");
  const [open, stopButton] = element.querySelectorAll("button");
  await act(async () => open.click());
  expect(onOpenSession).toHaveBeenCalledWith("missing");
  await act(async () => stopButton.click());
  expect(stop).toHaveBeenCalledOnce();
  await act(async () => reportDictation(owner, undefined));
  expect(element.textContent).toBe("");
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});
