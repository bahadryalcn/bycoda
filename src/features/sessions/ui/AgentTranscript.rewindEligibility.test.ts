// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const blocks: Block[] = [
  { id: "first", role: "user", text: "First turn" },
  { id: "answer", role: "assistant", text: "Done" },
  { id: "second", role: "user", text: "Next turn" },
];
const onRewindMessage = vi.fn();
const actions = () => host.querySelectorAll('[aria-label="Message actions"]');
async function render(eligible: boolean, busy = false) {
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy,
        canRewindMessage: (id) => eligible && id === "first",
        onRewindMessage,
      }),
    ),
  );
}

describe("reactive rewind eligibility", () => {
  it("shows rewind immediately when a native turn settles, without replacing historical blocks", async () => {
    await render(false, true);
    expect(actions()).toHaveLength(0);
    await render(true, false);
    expect(actions()).toHaveLength(1);
    expect(actions()[0].closest("[data-prompt-anchor]")?.getAttribute("data-prompt-anchor")).toBe(
      "first",
    );
    await render(false, true);
    expect(actions()).toHaveLength(0);
  });

  it("updates an otherwise unchanged settled transcript when a send blocker clears or returns", async () => {
    await render(false);
    expect(actions()).toHaveLength(0);
    await render(true);
    expect(actions()).toHaveLength(1);
    await render(false);
    expect(actions()).toHaveLength(0);
  });
});
