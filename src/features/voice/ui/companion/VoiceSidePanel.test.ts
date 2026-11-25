// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { VoiceSidePanel } from "./VoiceSidePanel";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 1;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 16,
    top: 200,
    right: 376,
    bottom: 784,
    width: 360,
    height: 584,
  } as DOMRect);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("paints the side panel with its own fill instead of a role the floating companion strips", async () => {
  const panel = createRef<HTMLElement>();
  await act(async () => {
    root.render(
      createElement(
        "section",
        { ref: panel, ...surfaceAttributes({ variant: "floating", frame: "pane" }) },
        createElement(VoiceSidePanel, { panel, label: "Question", openKey: "a" }, "body"),
      ),
    );
  });
  const companion = panel.current as HTMLElement;
  const side = host.querySelector<HTMLElement>("aside[data-side]");
  expect(side).not.toBeNull();
  // Surface.module.css drops the fill of a surface nested in the same role.
  expect(companion.getAttribute("data-surface-role")).toBe("floating");
  expect(side?.getAttribute("data-surface-role")).not.toBe("floating");
  expect(side?.closest('[data-surface-role="floating"] [data-surface-role="floating"]')).toBeNull();
});
