// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorDraftRecoveryMetadata } from "../../../features/files/data/editorDraftRecovery";
import { EditorDraftRecoverySection } from "./EditorDraftRecoverySection";
import type { useEditorDraftRecovery } from "../files/useEditorDraftRecovery";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const digest = (seed: string) => seed.repeat(64).slice(0, 64);
function row(name: string, unsaved: boolean, updatedAt = 1): EditorDraftRecoveryMetadata {
  return {
    ownerId: digest("a"),
    documentId: name,
    revision: 1,
    payloadDigest: digest("b"),
    path: `/work/${name}`,
    windowLabel: "main",
    state: "retained",
    serializedTextDigest: digest(unsaved ? "c" : "d"),
    baselineDigest: digest("d"),
    updatedAt,
  } as unknown as EditorDraftRecoveryMetadata;
}
const recovery = {
  loading: false,
  error: false,
  pendingKeys: new Set<string>(),
  errors: new Set<string>(),
  refresh: async () => {},
  restore: async () => {},
} as unknown as ReturnType<typeof useEditorDraftRecovery>;

async function render(records: EditorDraftRecoveryMetadata[]) {
  await act(async () =>
    root.render(createElement(EditorDraftRecoverySection, { recovery, records })),
  );
}
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

// Issue #776: the counts live on the segmented control only; no static line repeats them.
describe("file recovery pane summaries", () => {
  it("shows counts once on the segmented control and has no live status line while unfiltered", async () => {
    await render([row("a.ts", true), row("b.ts", false)]);
    expect(container.querySelector(".recovery-status")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toMatch(/unsaved drafts · /);
    expect(container.textContent).toContain("Unsaved drafts");
    expect(container.textContent).toContain("All copies");
  });

  it("uses one label per landmark and a placeholder that adds information", async () => {
    await render([row("a.ts", true)]);
    const labels = [...container.querySelectorAll("[aria-label]")].map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(new Set(labels).size).toBe(labels.length);
    const search = container.querySelector("input")!;
    expect(search.getAttribute("aria-label")).not.toBe(search.getAttribute("placeholder"));
    expect(search.getAttribute("placeholder")).toBe("Filter by file name or window");
  });

  it("announces only the filter result, and only while a filter hides rows", async () => {
    await render([row("alpha.ts", true), row("beta.ts", true)]);
    await type(container.querySelector("input")!, "alpha");
    const status = container.querySelector(".recovery-status");
    expect(status?.textContent).toContain("Showing 1 of 2");
    await type(container.querySelector("input")!, "");
    expect(container.querySelector(".recovery-status")).toBeNull();
  });
});
