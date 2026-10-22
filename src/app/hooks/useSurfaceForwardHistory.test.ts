// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSurfaceForwardHistory } from "./useSurfaceForwardHistory";
import { useMouseNavigation } from "./useMouseNavigation";

type Surface = { view: string; tab: string };
let navigation: ReturnType<typeof useSurfaceForwardHistory<Surface>>;
let change: (surface: Surface) => void;
let current: Surface;
let root: Root;
let container: HTMLDivElement;
const fallbackForward = vi.fn();

function Harness() {
  const [surface, setSurface] = useState({ view: "settings", tab: "a" });
  current = surface;
  change = setSurface;
  navigation = useSurfaceForwardHistory(surface, setSurface);
  useMouseNavigation(
    () => {
      const destination = {
        ...surface,
        view: surface.view === "settings" ? "notes" : "conversation",
      };
      navigation.remember(destination);
      setSurface(destination);
    },
    () => {
      if (!navigation.forward()) fallbackForward();
    },
  );
  return createElement("textarea");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fallbackForward.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mouse(button: number) {
  act(() =>
    container
      .querySelector("textarea")!
      .dispatchEvent(new MouseEvent("mousedown", { button, bubbles: true, cancelable: true })),
  );
}

describe("surface forward navigation", () => {
  it("restores surfaces in order using the actual mouse side-button handlers", () => {
    mouse(3);
    expect(current.view).toBe("notes");
    expect(navigation.canForward).toBe(true);
    mouse(3);
    expect(current.view).toBe("conversation");
    mouse(4);
    expect(current.view).toBe("notes");
    mouse(4);
    expect(current.view).toBe("settings");
    expect(navigation.canForward).toBe(false);
    expect(fallbackForward).not.toHaveBeenCalled();
    mouse(4);
    expect(fallbackForward).toHaveBeenCalledOnce();
  });

  it.each([
    { view: "inbox", tab: "a" },
    { view: "notes", tab: "b" },
  ])("discards the forward path after unrelated navigation to %j", (surface) => {
    mouse(3);
    act(() => change(surface));
    expect(navigation.canForward).toBe(false);
    mouse(4);
    expect(current).toEqual(surface);
    expect(fallbackForward).toHaveBeenCalledOnce();
  });
});
