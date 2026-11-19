// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ActivityPhases } from "./AgentTranscriptActivity";

// An agent line with no steps under it has no disclosure, so a note cut at the
// pane width must stay readable through the overflow tooltip (pointer) and
// stay focusable to open it (keyboard).
it("keeps a lone agent note reachable by keyboard and by the overflow tooltip", async () => {
  const note = "Checking how the activity list truncates a long agent commentary line.";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ActivityPhases, {
          blocks: [{ id: "note-1", role: "assistant", text: note }],
          done: true,
        }),
      ),
    );
    const anchor = container.querySelector<HTMLElement>("[data-tooltip-owner]");
    expect(anchor).not.toBeNull();
    expect(anchor!.tabIndex).toBe(0);
    expect(anchor!.textContent).toContain(note);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
