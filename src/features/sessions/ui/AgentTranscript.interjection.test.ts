// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;
let bodyHeight: number;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // happy-dom has no layout; supply the measured dimensions, not an estimate
  // based on text length (a short string can wrap in a narrow transcript).
  bodyHeight = 200;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => bodyHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 40);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// The labeled divider is the live rendering — the note lands while the turn
// is still going. A settled turn folds it into the work trail as one compact
// line instead, which the last test covers.
function render(text: string, severity: "blocker" | "concern" = "concern") {
  const blocks: Block[] = [
    {
      id: "advisor",
      role: "system",
      text,
      interjection: { customType: "advisor", severity },
    },
  ];
  act(() => root.render(createElement(AgentTranscript, { blocks, busy: true })));
}

const note =
  "Check the fallback.\n```ts\nconst result = read();\nif (!result) throw new Error('missing');\n```";

describe("AgentTranscript interjection preview", () => {
  it("keeps the label and one summary line, and mounts the full text only when opened", () => {
    render(note, "blocker");
    expect(container.querySelector('[aria-label="Interjection: Advisor"]')?.textContent).toContain(
      "Blocker",
    );
    const trigger = container.querySelector<HTMLElement>("summary")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("pre")).toBeNull();
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("pre")?.textContent).toBe(note);
  });

  it("closes again from the same row", () => {
    render(note);
    const trigger = container.querySelector<HTMLElement>("summary")!;
    act(() => trigger.click());
    expect(container.querySelector("pre")).not.toBeNull();
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("settles into the work trail as one compact line that opens to the full note", () => {
    const blocks: Block[] = [
      {
        id: "advisor",
        role: "system",
        text: note,
        interjection: { customType: "advisor", severity: "concern" },
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: false })));
    // No divider, no clamped body: one line in the trail, named and
    // severity-marked, that opens on a click.
    expect(container.querySelector('[role="separator"]')).toBeNull();
    const button = container.querySelector<HTMLElement>('summary[aria-expanded="false"]')!;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Advisor");
    expect(button.textContent).toContain("Concern");
    expect(button.textContent).toContain("Check the fallback.");
    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("pre")?.textContent).toBe(note);
  });
});
