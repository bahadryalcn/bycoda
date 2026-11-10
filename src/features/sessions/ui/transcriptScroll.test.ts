// @vitest-environment jsdom
import { expect, it } from "vitest";
import { syncTranscriptViewport } from "./transcriptScroll";

function transcript(height: number) {
  const scroller = document.createElement("div");
  const inner = document.createElement("div");
  const earlier = document.createElement("div");
  const anchored = document.createElement("div");
  anchored.className = "transcript-turn transcript-turn-anchor";
  inner.append(earlier, anchored);
  scroller.append(inner);
  document.body.append(scroller);
  let current = height;
  Object.defineProperty(scroller, "clientHeight", { get: () => current });
  return { scroller, earlier, anchored, resize: (next: number) => (current = next) };
}

it("sizes the anchored turn without restyling the whole transcript", () => {
  const { scroller, earlier, anchored, resize } = transcript(600);

  syncTranscriptViewport(scroller);
  expect(anchored.style.getPropertyValue("--transcript-viewport")).toBe("600px");

  resize(420);
  syncTranscriptViewport(scroller, true);
  expect(anchored.style.getPropertyValue("--transcript-viewport")).toBe("420px");

  // A custom property on the scroller is inherited by every element of the
  // transcript, so a panel drag restyled all of it on each frame.
  expect(scroller.style.getPropertyValue("--transcript-viewport")).toBe("");
  expect(earlier.style.getPropertyValue("--transcript-viewport")).toBe("");
});

it("sizes a turn that became the anchor after the last resize", () => {
  const { scroller, earlier } = transcript(600);
  syncTranscriptViewport(scroller);

  earlier.className = "transcript-turn transcript-turn-anchor";
  syncTranscriptViewport(scroller);

  expect(earlier.style.getPropertyValue("--transcript-viewport")).toBe("600px");
});
