// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { gitPanelRuntime, resetGitPanelState, useGitPanelRuntime } from "./gitPanelState";
import { CHECKOUT_CACHE_ENTRIES } from "./checkoutCache";
import { useCommitDraft } from "../hooks/useCommitDraft";

const api = vi.hoisted(() => ({ head: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({ gitHeadMessage: api.head }));
vi.mock("../../../integrations/harness", () => ({ generateCommitMessage: vi.fn() }));
vi.mock("../ui/GitGenerationSettings", () => ({
  useGitGenerationChoice: () => [null, vi.fn(), false],
}));
afterEach(() => {
  resetGitPanelState();
  vi.unstubAllGlobals();
});

it("rechecks canonical runtime between render and subscription without abandoned-render pins", () => {
  resetGitPanelState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let current!: ReturnType<typeof gitPanelRuntime>;
  let churn = true;
  function Probe() {
    current = useGitPanelRuntime("/view");
    if (churn) {
      churn = false;
      for (let i = 0; i <= CHECKOUT_CACHE_ENTRIES; i++) gitPanelRuntime(`/other-${i}`);
    }
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(Probe)));
    expect(current!).toBe(gitPanelRuntime("/view"));
    for (let i = 0; i <= CHECKOUT_CACHE_ENTRIES; i++) gitPanelRuntime(`/after-${i}`);
    expect(current!).toBe(gitPanelRuntime("/view"));
  } finally {
    act(() => root.unmount());
  }
});

it("holds original amend read across unmount and never overwrites a newer draft", async () => {
  resetGitPanelState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: (value: string) => void;
  api.head.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  let draft!: ReturnType<typeof useCommitDraft>;
  function Probe() {
    draft = useCommitDraft({
      cwd: "/draft",
      index: { branch: "main", head: "original", files: [] } as never,
      canGenerate: false,
      fail: vi.fn(),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  const original = gitPanelRuntime("/draft");
  let pending!: Promise<void>;
  act(() => {
    pending = draft.toggleAmend();
  });
  act(() => root.unmount());
  for (let i = 0; i <= CHECKOUT_CACHE_ENTRIES; i++) gitPanelRuntime(`/other-${i}`);
  expect(gitPanelRuntime("/draft")).toBe(original);
  original.state.message = "New owner draft";
  resolve("Old HEAD message");
  await act(async () => {
    await pending;
  });
  expect(original.state.message).toBe("New owner draft");
  expect(original.state.amendTarget).toBeNull();
});

it("fences an old amend continuation after a replacement panel edits the retained draft", async () => {
  resetGitPanelState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: (value: string) => void;
  api.head.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  let draft!: ReturnType<typeof useCommitDraft>;
  function Probe() {
    draft = useCommitDraft({
      cwd: "/remounted-draft",
      index: { branch: "main", head: "original", files: [] } as never,
      canGenerate: false,
      fail: vi.fn(),
    });
    return null;
  }
  const oldRoot = createRoot(document.createElement("div"));
  act(() => oldRoot.render(createElement(Probe)));
  let pending!: Promise<void>;
  act(() => {
    pending = draft.toggleAmend();
  });
  act(() => oldRoot.unmount());
  const replacement = createRoot(document.createElement("div"));
  try {
    act(() => replacement.render(createElement(Probe)));
    act(() => draft.setMessage("Replacement panel draft"));
    resolve("Old HEAD message");
    await act(async () => {
      await pending;
    });
    expect(draft.message).toBe("Replacement panel draft");
    expect(draft.amend).toBe(false);
  } finally {
    act(() => replacement.unmount());
  }
});
