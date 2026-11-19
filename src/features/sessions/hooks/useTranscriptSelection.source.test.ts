// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTranscriptSelection } from "./useTranscriptSelection";
import {
  SELECTABLE_AGENT_RESPONSE_ATTR,
  type TranscriptSelection,
} from "../model/transcriptSelection";

it("keeps response text out of live state and reads the exact occurrence only when resolved", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const surface = document.createElement("div");
  surface.innerHTML = `<div ${SELECTABLE_AGENT_RESPONSE_ATTR}="answer"><p>Same and Same</p></div>`;
  document.body.append(surface);
  const mount = document.createElement("div");
  const root = createRoot(mount);
  // Held in an object so the harness's assignments are not narrowed away by TypeScript.
  const state: { selection: TranscriptSelection | null } = { selection: null };
  function Harness() {
    state.selection = useTranscriptSelection(surface, true).selection;
    return null;
  }
  const paragraphText = surface.querySelector("p")!.firstChild!;
  // Selects the second "Same" in the reply.
  const range = document.createRange();
  range.setStart(paragraphText, 9);
  range.setEnd(paragraphText, 13);
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue({ length: 0 } as DOMRectList);
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 100, 20));
  try {
    await act(async () => root.render(createElement(Harness)));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const selected = state.selection;
    expect(selected?.text).toBe("Same");
    expect(selected).not.toHaveProperty("responseText");
    expect(selected).not.toHaveProperty("occurrence");
    expect(selected?.resolveSource?.()).toEqual({
      occurrence: 1,
      responseText: "Same and Same",
    });

    // A concurrent edit before the selection: the next resolution counts against the current text.
    surface.querySelector("p")!.insertBefore(document.createTextNode("Same "), paragraphText);
    expect(selected?.resolveSource?.()).toEqual({
      occurrence: 2,
      responseText: "Same Same and Same",
    });

    // Once the selected text is gone, resolution refuses rather than reporting a stale location.
    surface.querySelector("p")!.textContent = "Changed";
    expect(selected?.resolveSource?.()).toBeNull();
  } finally {
    act(() => root.unmount());
    window.getSelection()?.removeAllRanges();
    surface.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
