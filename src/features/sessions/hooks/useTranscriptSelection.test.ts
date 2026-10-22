// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTranscriptSelection } from "./useTranscriptSelection";
import {
  SELECTABLE_AGENT_RESPONSE_ATTR,
  type TranscriptSelection,
} from "../model/transcriptSelection";

it.each([[false, false], [false, true], [true, false], [true, true]])(
  "accepts an empty action-row boundary but rejects selecting action text (outside: %s, reverse: %s)",
  async (outsideText, reverse) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const surface = document.createElement("div");
    surface.innerHTML = `<div ${SELECTABLE_AGENT_RESPONSE_ATTR}="answer"><p>Last paragraph.</p></div><div>Copy</div>`;
    document.body.append(surface);
    const mount = document.createElement("div");
    const root = createRoot(mount);
    let selected: TranscriptSelection | null = null;
    function Harness() {
      selected = useTranscriptSelection(surface, true).selection;
      return null;
    }
    const range = document.createRange();
    range.setStart(surface.querySelector("p")!.firstChild!, 0);
    range.setEnd(surface.lastElementChild!.firstChild!, outsideText ? 4 : 0);
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue({ length: 0 } as DOMRectList);
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(10, 10, 100, 20),
    );
    try {
      await act(async () => root.render(createElement(Harness)));
      window.getSelection()!.removeAllRanges();
      if (reverse) window.getSelection()!.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
      else window.getSelection()!.addRange(range);
      await act(async () => {
        document.dispatchEvent(new Event("selectionchange"));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(selected?.text ?? null).toBe(outsideText ? null : "Last paragraph.");
      if (!outsideText) expect(selected?.responseId).toBe("answer");
    } finally {
      act(() => root.unmount());
      window.getSelection()?.removeAllRanges();
      surface.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
