// @vitest-environment happy-dom
import { StrictMode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearComposerDraft, composerDraftOf, setComposerDraftSnapshot } from "../model/draftCache";
import type { Block } from "../model/session";
import { useSavedDraftProjection } from "./useSavedDraftProjection";
import { Composer } from "./Composer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), isTauri: () => false }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));
vi.mock("../data/composerDraftStore", async (original) => ({
  ...(await original<typeof import("../data/composerDraftStore")>()),
  composerDraftsLoaded: () => true,
  subscribeComposerDraftLoadState: () => () => {},
}));
const owner = vi.hoisted(() => ({ hydrate: vi.fn(), fenced: vi.fn() }));
vi.mock("../../connections/public/sessionExecutionBinding", () => ({
  hydrateHostSessionBindings: owner.hydrate,
  hasHostSessionOwnerFence: owner.fenced,
}));

const block: Block = {
  id: "saved",
  role: "user",
  text: "saved text",
  draft: true,
  attachments: [
    {
      id: "file",
      name: "file.txt",
      path: "/file.txt",
      kind: "file",
      mimeType: "text/plain",
      size: 5,
    },
  ],
};
const host = document.createElement("div");
let root = createRoot(host);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
beforeEach(() => {
  owner.hydrate.mockReset().mockResolvedValue(undefined);
  owner.fenced.mockReset().mockReturnValue(false);
});
function Probe({ sessionId, draft }: { sessionId: string; draft?: Block }) {
  const result = useSavedDraftProjection(sessionId, draft);
  return createElement("div", {
    "data-ready": String(result.ready),
    "data-projected": String(result.projected),
    "data-failed": String(result.failed),
    onClick: result.retry,
  });
}
function ComposerProbe({ sessionId, draft }: { sessionId: string; draft?: Block }) {
  const projection = useSavedDraftProjection(sessionId, draft);
  return projection.ready
    ? createElement(Composer, {
        sessionId,
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        initialDraft: projection.initialDraft,
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: vi.fn(),
        onDraftChange: vi.fn(),
      })
    : null;
}
afterEach(() => {
  act(() => root.unmount());
  clearComposerDraft("projection-a");
  clearComposerDraft("projection-b");
  root = createRoot(host);
});

it("keeps the saved source when owner hydration fails and retries safely", async () => {
  owner.hydrate.mockRejectedValueOnce(new Error("owner unavailable"));
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  expect(composerDraftOf("projection-a").text).toBe("");
  expect(host.firstElementChild?.getAttribute("data-failed")).toBe("true");
  await act(async () => (host.firstElementChild as HTMLElement).click());
  expect(composerDraftOf("projection-a").text).toBe("saved text");
});

it("does not seed an old session after late owner hydration", async () => {
  let finish!: () => void;
  owner.hydrate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-b", draft: block })),
  );
  await act(async () => finish());
  expect(composerDraftOf("projection-a").text).toBe("");
  expect(composerDraftOf("projection-b").text).toBe("saved text");
});

it("rechecks input after owner hydration before seeding", async () => {
  let finish!: () => void;
  owner.hydrate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  setComposerDraftSnapshot("projection-a", { text: "new input", mcpTags: [], attachments: [] });
  await act(async () => finish());
  expect(composerDraftOf("projection-a").text).toBe("new input");
  expect(host.firstElementChild?.getAttribute("data-projected")).toBe("false");
});

it("does not project a session with an owner fence", async () => {
  owner.fenced.mockReturnValue(true);
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  expect(composerDraftOf("projection-a").text).toBe("");
  expect(host.firstElementChild?.getAttribute("data-ready")).toBe("false");
});

it("seeds once across StrictMode replay and remount with exact attachment identity", async () => {
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(Probe, { sessionId: "projection-a", draft: block }),
      ),
    ),
  );
  expect(composerDraftOf("projection-a").text).toBe("saved text");
  expect(composerDraftOf("projection-a").attachments).toEqual(block.attachments);
  expect(host.firstElementChild?.getAttribute("data-ready")).toBe("true");
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-b", draft: block })),
  );
  expect(composerDraftOf("projection-b").text).toBe("saved text");
});

it("mounts the editor with the projected text and preserves subsequent typing", async () => {
  await act(async () =>
    root.render(createElement(ComposerProbe, { sessionId: "projection-a", draft: block })),
  );
  const input = host.querySelector("textarea")!;
  expect(input.value).toBe("saved text");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "new text",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    root.render(createElement(ComposerProbe, { sessionId: "projection-a", draft: block })),
  );
  expect(input.value).toBe("new text");
});

it("keeps newer input and attachments instead of replacing them", async () => {
  const newer = { text: "newer", mcpTags: [], attachments: block.attachments ?? [] };
  setComposerDraftSnapshot("projection-a", newer);
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  expect(composerDraftOf("projection-a").text).toBe("newer");
  expect(composerDraftOf("projection-a").attachments).toBe(newer.attachments);
  expect(host.firstElementChild?.getAttribute("data-projected")).toBe("false");
});

it("keeps a deliberately cleared projection empty on remount", async () => {
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  setComposerDraftSnapshot("projection-a", {
    text: "",
    mcpTags: [],
    attachments: [],
  });
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-b", draft: block })),
  );
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  expect(composerDraftOf("projection-a").text).toBe("");
  expect(host.firstElementChild?.getAttribute("data-projected")).toBe("true");
});

it.each([
  { ...block, text: "changed" },
  { ...block, attachments: [{ ...block.attachments![0], path: "/other.txt" }] },
  { ...block, attachments: [{ ...block.attachments![0], data: "different" }] },
])("does not associate edited input with a changed source", async (changed) => {
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: changed })),
  );
  expect(host.firstElementChild?.getAttribute("data-projected")).toBe("false");
  expect(composerDraftOf("projection-a").attachments[0].path).toBe("/file.txt");
});

it("leaves a different source marker as a conflict", async () => {
  setComposerDraftSnapshot("projection-a", {
    text: "",
    mcpTags: [],
    attachments: [],
    sourceDraftId: "other",
  });
  await act(async () =>
    root.render(createElement(Probe, { sessionId: "projection-a", draft: block })),
  );
  expect(composerDraftOf("projection-a").sourceDraftId).toBe("other");
  expect(host.firstElementChild?.getAttribute("data-projected")).toBe("false");
});
