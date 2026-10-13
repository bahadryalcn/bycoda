import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const cache = await import("../model/draftCache");
const store = await import("./composerDraftStore");

const saved = (sessionId: string, draft: unknown) => ({ sessionId, draft });

function answer(rows: unknown[]) {
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "session_list_drafts") return Promise.resolve(rows);
    if (cmd === "inspect_paths") {
      return Promise.resolve([{ path: "/tmp/here.txt", name: "here.txt", size: 1, isDir: false }]);
    }
    return Promise.resolve(null);
  });
}

const writes = () =>
  invoke.mock.calls.filter(([cmd]) => cmd === "session_set_draft").map(([, args]) => args);

describe("composer draft store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
  });
  afterEach(async () => {
    for (const id of ["d1", "d2", "d3"]) cache.clearComposerDraft(id);
    await store.flushComposerDrafts();
    vi.useRealTimers();
  });

  it("loads saved drafts into the cache, dropping gone files and saying so", async () => {
    answer([
      saved("d1", { text: "unsent", attachments: [], mcpTags: [] }),
      saved("d2", {
        text: "see [file1] [file2]",
        attachments: [
          {
            id: "f1",
            name: "here.txt",
            mimeType: "text/plain",
            kind: "file",
            size: 1,
            path: "/tmp/here.txt",
          },
          {
            id: "f2",
            name: "gone.txt",
            mimeType: "text/plain",
            kind: "file",
            size: 1,
            path: "/tmp/gone.txt",
          },
        ],
      }),
      saved("bad id/../x", { text: "ignored" }),
      saved("d3", "garbage"),
    ]);
    await store.hydrateComposerDrafts();
    expect(cache.getComposerDraft("d1")).toBe("unsent");
    expect(cache.getComposerDraft("d2")).toBe("see [file1]");
    expect(cache.getComposerAttachments("d2").map((file) => file.name)).toEqual(["here.txt"]);
    expect(cache.takeComposerNotice("d2")).toContain("gone.txt");
    expect(cache.getComposerDraft("d3")).toBeUndefined();
    // Nothing was typed, so nothing is written back until something changes
    // (the cleaned draft of d2 is the one exception).
    await vi.advanceTimersByTimeAsync(600);
    expect(writes().map((write) => (write as { sessionId: string }).sessionId)).toEqual(["d2"]);
  });

  it("writes through after the debounce, once, with the latest text", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    cache.setComposerDraft("d1", "h");
    cache.setComposerDraft("d1", "he");
    cache.setComposerDraft("d1", "hel");
    await vi.advanceTimersByTimeAsync(499);
    expect(writes()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ sessionId: "d1", draft: { text: "hel" } });
  });

  it("flushes pending drafts at once", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    cache.setComposerDraft("d1", "quit now");
    await store.flushComposerDrafts();
    expect(writes()).toEqual([
      expect.objectContaining({
        sessionId: "d1",
        draft: expect.objectContaining({ text: "quit now" }),
      }),
    ]);
    await vi.advanceTimersByTimeAsync(600);
    expect(writes()).toHaveLength(1);
  });

  it("deletes the row when the draft is cleared (sent or session deleted)", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    cache.setComposerDraft("d1", "to send");
    await store.flushComposerDrafts();
    cache.clearComposerDraft("d1");
    await store.flushComposerDrafts();
    expect(writes().at(-1)).toEqual({ sessionId: "d1", draft: null });
  });

  it("does not create or clear a row for a draft that never had one", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    cache.setComposerDraft("d3", "x");
    cache.setComposerDraft("d3", "");
    await store.flushComposerDrafts();
    expect(writes()).toHaveLength(0);
  });
});
