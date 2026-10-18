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
  it("spills aggregate inline image bytes and round-trips every attachment under the native row cap", async () => {
    const id = "aggregate-images";
    answer([]);
    await store.hydrateComposerDrafts();
    const images = ["one", "two"].map((name) => ({
      id: name,
      name: `${name}.png`,
      kind: "image" as const,
      mimeType: "image/png",
      size: 3_375_000,
      data: "A".repeat(4_500_000),
    }));
    let persisted: any;
    invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "write_attachment") return `/owned/${args.name}`;
      if (command === "session_set_draft" && args.sessionId === id) {
        if (new TextEncoder().encode(JSON.stringify(args.draft)).byteLength > 8_000_000)
          throw new Error("draft is too large");
        persisted = args.draft;
      }
      if (command === "inspect_paths")
        return args.paths.map((path: string) => ({
          path,
          name: "one.png",
          size: 3_375_000,
          isDir: false,
        }));
      return [];
    });
    cache.setComposerDraft(id, "both [image1] [image2]");
    cache.setComposerDraftMode(id, "save");
    cache.setComposerAttachments(id, images);
    await store.flushComposerDrafts();
    expect(persisted.mode).toBe("save");
    expect(persisted.attachments).toHaveLength(2);
    expect(
      persisted.attachments.every((file: any) => !file.missing && (file.path || file.data)),
    ).toBe(true);
    expect(cache.getComposerAttachments(id)).toBe(images);
    const spillCount = invoke.mock.calls.filter(
      ([command]) => command === "write_attachment",
    ).length;
    cache.setComposerDraft(id, "both again [image1] [image2]");
    await store.flushComposerDrafts();
    expect(invoke.mock.calls.filter(([command]) => command === "write_attachment")).toHaveLength(
      spillCount,
    );
    const row = persisted;
    cache.clearComposerDraft(id);
    await store.flushComposerDrafts();
    invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "session_list_drafts") return [saved(id, row)];
      if (command === "inspect_paths")
        return args.paths.map((path: string) => ({
          path,
          name: "one.png",
          size: 3_375_000,
          isDir: false,
        }));
      return [];
    });
    await store.hydrateComposerDrafts();
    expect(cache.getComposerAttachments(id)).toHaveLength(2);
    expect(cache.getComposerDraftMode(id)).toBe("save");
    expect(cache.takeComposerNotice(id)).toBeUndefined();
    cache.clearComposerDraft(id);
  });

  it("keeps failed attachment spills dirty and retries without writing missing placeholders", async () => {
    const id = "spill-retry";
    answer([]);
    await store.hydrateComposerDrafts();
    let fail = true;
    invoke.mockImplementation(async (command: string) => {
      if (command === "write_attachment") {
        if (fail) throw new Error("disk full");
        return "/owned/retry.png";
      }
      return [];
    });
    cache.setComposerDraft(id, "keep my image");
    cache.setComposerAttachments(id, [
      {
        id: "big",
        name: "retry.png",
        kind: "image",
        mimeType: "image/png",
        size: 4_500_001,
        data: "A".repeat(6_000_004),
      },
    ]);
    await expect(store.flushComposerDrafts()).rejects.toThrow("disk full");
    expect(writes().filter((write) => write.sessionId === id)).toEqual([]);
    expect(cache.getComposerAttachments(id)[0].data).toHaveLength(6_000_004);
    fail = false;
    await store.flushComposerDrafts();
    expect(writes().find((write) => write.sessionId === id)?.draft.attachments[0]).toMatchObject({
      path: "/owned/retry.png",
    });
    cache.clearComposerDraft(id);
  });

  it("serializes an explicit clear after an attachment spill already in flight", async () => {
    const id = "spill-clear";
    answer([]);
    await store.hydrateComposerDrafts();
    let finish!: (path: string) => void;
    invoke.mockImplementation((command: string) =>
      command === "write_attachment"
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve([]),
    );
    cache.setComposerDraft(id, "old image");
    cache.setComposerAttachments(id, [
      {
        id: "big",
        name: "clear.png",
        kind: "image",
        mimeType: "image/png",
        size: 4_500_001,
        data: "A".repeat(6_000_004),
      },
    ]);
    const flushing = store.flushComposerDrafts();
    cache.clearComposerDraft(id);
    finish("/owned/clear.png");
    await flushing;
    expect(
      writes()
        .filter((write) => write.sessionId === id)
        .at(-1),
    ).toEqual({ sessionId: id, draft: null });
    expect(cache.getComposerAttachments(id)).toEqual([]);
  });
  it("deletes an obsolete disk draft after a failed startup read and a newer clear", async () => {
    const id = "failed-startup-read";
    let persisted: unknown = { text: "obsolete", attachments: [], mcpTags: [] };
    let failRead = true;
    invoke.mockImplementation(
      async (command: string, args?: { sessionId: string; draft: unknown }) => {
        if (command === "session_list_drafts") {
          if (failRead) throw new Error("database unavailable");
          return persisted ? [saved(id, persisted)] : [];
        }
        if (command === "session_set_draft" && args?.sessionId === id) persisted = args.draft;
        return null;
      },
    );
    await store.hydrateComposerDrafts();
    cache.setComposerDraft(id, "new text");
    cache.clearComposerDraft(id);
    await store.flushComposerDrafts();
    expect(writes()).toContainEqual({ sessionId: id, draft: null });
    expect(persisted).toBeNull();
    failRead = false;
    await store.hydrateComposerDrafts();
    expect(cache.getComposerDraft(id)).toBeUndefined();
  });

  it("does not restore a late attachment check over a newer explicit clear", async () => {
    const id = "late-startup-check";
    let finish!: (paths: unknown[]) => void;
    const checking = new Promise<unknown[]>((resolve) => {
      finish = resolve;
    });
    invoke.mockImplementation((command: string) => {
      if (command === "session_list_drafts")
        return Promise.resolve([
          saved(id, {
            text: "old [file1]",
            mcpTags: [],
            attachments: [
              {
                id: "old-file",
                name: "here.txt",
                kind: "file",
                mimeType: "text/plain",
                size: 1,
                path: "/tmp/here.txt",
              },
            ],
          }),
        ]);
      if (command === "inspect_paths") return checking;
      return Promise.resolve(null);
    });
    const hydration = store.hydrateComposerDrafts();
    await vi.advanceTimersByTimeAsync(2001);
    await hydration;
    cache.setComposerDraft(id, "new text");
    cache.clearComposerDraft(id);
    finish([{ path: "/tmp/here.txt", name: "here.txt", size: 1, isDir: false }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.getComposerDraft(id)).toBeUndefined();
    expect(cache.getComposerAttachments(id)).toEqual([]);
    await store.flushComposerDrafts();
    expect(writes()).toContainEqual({ sessionId: id, draft: null });
  });
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
  });
  afterEach(async () => {
    answer([]);
    for (const id of ["d1", "d2", "d3"]) cache.clearComposerDraft(id);
    await store.flushComposerDrafts();
    vi.useRealTimers();
  });

  it("waits for an already running debounce write and serializes a newer draft", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    let finish!: () => void;
    invoke.mockImplementation((cmd: string) =>
      cmd === "session_set_draft"
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve([]),
    );
    cache.setComposerDraft("d1", "first draft");
    await vi.advanceTimersByTimeAsync(501);
    let flushed = false;
    const flushing = store.flushComposerDrafts().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    cache.setComposerDraft("d1", "newer draft");
    answer([]);
    finish();
    await flushing;
    expect(writes().map((write) => write.draft.text)).toEqual(["first draft", "newer draft"]);
  });

  it("reports an explicit persistence failure and retries the unchanged draft after recovery", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    invoke.mockRejectedValue(new Error("disk unavailable"));
    cache.setComposerDraft("d1", "irreplaceable draft");
    await expect(store.flushComposerDrafts()).rejects.toThrow("disk unavailable");
    answer([]);
    await store.flushComposerDrafts();
    expect(writes()).toHaveLength(2);
    expect(writes()[1].draft.text).toBe("irreplaceable draft");
  });

  it("retries a failed background save on a later flush without another edit", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    invoke.mockRejectedValue(new Error("disk unavailable"));
    cache.setComposerDraft("d1", "background failure draft");
    await vi.advanceTimersByTimeAsync(501);
    expect(writes()).toHaveLength(1);
    answer([]);
    await store.flushComposerDrafts();
    expect(writes()).toHaveLength(2);
    expect(writes()[1].draft.text).toBe("background failure draft");
  });

  it("reports an in-flight failure after other sessions finish, then retries only the failed draft", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    let failFirst!: (reason: Error) => void;
    let finishSecond!: () => void;
    invoke.mockImplementation((_cmd: string, args: { sessionId: string }) =>
      args.sessionId === "d1"
        ? new Promise<void>((_resolve, reject) => {
            failFirst = reject;
          })
        : new Promise<void>((resolve) => {
            finishSecond = resolve;
          }),
    );
    cache.setComposerDraft("d1", "first unsaved");
    cache.setComposerDraft("d2", "second unsaved");
    await vi.advanceTimersByTimeAsync(501);
    let settled = false;
    const flushing = store.flushComposerDrafts().then(
      () => "saved",
      (reason: Error) => {
        settled = true;
        return reason.message;
      },
    );
    failFirst(new Error("write failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    finishSecond();
    expect(await flushing).toBe("write failed");
    answer([]);
    await store.flushComposerDrafts();
    expect(writes().map((write) => [write.sessionId, write.draft.text])).toEqual([
      ["d1", "first unsaved"],
      ["d2", "second unsaved"],
      ["d1", "first unsaved"],
    ]);
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
