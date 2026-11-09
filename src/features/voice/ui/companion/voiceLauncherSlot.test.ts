// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceLauncher, VoiceLauncherFrame } from "./VoiceLauncher";
import { VoiceLauncherSlot } from "./voiceLauncherSlot";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom has no layout: an element inside a `hidden` wrapper has no boxes.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.closest("[hidden]") ? [] : [{}]) as unknown as DOMRectList;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const marker = createElement("span", { id: "launcher" });

it("floats in the window corner without a visible footer slot", () => {
  act(() => root.render(createElement(VoiceLauncherFrame, null, marker)));
  expect(
    document.querySelector("#launcher")?.parentElement?.hasAttribute("data-voice-launcher-slot"),
  ).toBe(false);
});

it("docks into the rendered footer copy, never a hidden one", () => {
  act(() =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement("div", { hidden: true, id: "wide" }, createElement(VoiceLauncherSlot)),
        createElement(
          "div",
          { id: "compact" },
          createElement(VoiceLauncherSlot, { compact: true }),
        ),
        createElement(VoiceLauncherFrame, null, marker),
      ),
    ),
  );
  const slot = document.querySelector("#launcher")?.parentElement;
  expect(slot?.closest("#compact")).not.toBeNull();
  expect(slot?.hasAttribute("data-active")).toBe(true);
});

const launcher = (name: string, state: "off" | "listening" = "off") =>
  createElement(VoiceLauncher, {
    ref: null,
    visual: "orb",
    name,
    avatar: undefined,
    state,
    onOpen: () => {},
  } as Parameters<typeof VoiceLauncher>[0]);

it("shows the assistant avatar with a status dot, docked or floating", () => {
  act(() =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(
          "div",
          { id: "compact" },
          createElement(VoiceLauncherSlot, { compact: true }),
        ),
        launcher("Arif", "listening"),
      ),
    ),
  );
  const button = document.querySelector("#compact button");
  expect(button?.getAttribute("aria-label")).toBe("Talk to Arif");
  expect(button?.querySelector("[data-avatar]")?.getAttribute("data-initial")).toBe("A");
  expect(button?.querySelector("[data-state]")?.getAttribute("data-state")).toBe("listening");
  expect(button?.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("success");
});

it("keeps the voice visual before the assistant has a name", () => {
  act(() => root.render(launcher("")));
  expect(document.querySelector("[data-avatar]")).toBeNull();
  expect(document.body.textContent).toContain("Voice");
});
