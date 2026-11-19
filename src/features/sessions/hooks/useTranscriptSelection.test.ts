// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTranscriptSelection } from "./useTranscriptSelection";
import {
  SELECTABLE_AGENT_RESPONSE_ATTR,
  type TranscriptSelection,
} from "../model/transcriptSelection";

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
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
      if (reverse)
        window
          .getSelection()!
          .setBaseAndExtent(
            range.endContainer,
            range.endOffset,
            range.startContainer,
            range.startOffset,
          );
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

it("re-reads the selection geometry from the live range and reports loss only when the text is gone", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const surface = document.createElement("div");
  surface.innerHTML = `<div ${SELECTABLE_AGENT_RESPONSE_ATTR}="answer"><p>Streaming reply.</p></div>`;
  document.body.append(surface);
  const mount = document.createElement("div");
  const root = createRoot(mount);
  let selected: TranscriptSelection | null = null;
  function Harness() {
    selected = useTranscriptSelection(surface, true).selection;
    return null;
  }
  let rect = new DOMRect(10, 100, 100, 20);
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(
    () => ({ length: 1, item: () => rect }) as unknown as DOMRectList,
  );
  try {
    await act(async () => root.render(createElement(Harness)));
    const range = document.createRange();
    range.selectNodeContents(surface.querySelector("p")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(selected?.rect.y).toBe(100);
    // Scrolling moves the text; the next measurement follows it instead of keeping the old rect.
    rect = new DOMRect(10, 40, 100, 20);
    expect(selected?.measure?.()?.rect.y).toBe(40);
    // Text appended after the selection (streaming) does not disturb it.
    surface.querySelector("p")!.append(document.createElement("span"));
    expect(selected?.measure?.()).not.toBeNull();
    // The selected text being replaced is an actual loss.
    surface.querySelector("p")!.replaceChildren("Different reply.");
    expect(selected?.measure?.()).toBeNull();
  } finally {
    act(() => root.unmount());
    window.getSelection()?.removeAllRanges();
    surface.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
