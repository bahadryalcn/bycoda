import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("../../connections/model/sessionExecutionBinding", async (original) => ({
  ...(await original<typeof import("../../connections/model/sessionExecutionBinding")>()),
  flushHostSessionBindings: vi.fn(async () => {}),
}));

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
  it("reports attachment removal only after its native draft write succeeds", async () => {
    answer([]);
    await store.hydrateComposerDrafts();
    cache.setComposerDraft("d1", "held attachment");
    cache.setComposerAttachments("d1", [
      { id: "held", name: "a.txt", kind: "file", mimeType: "text/plain", size: 1, data: "eA==" },
    ]);
    await store.flushComposerDrafts();
    const observed = vi.fn();
    const stop = store.subscribePersistedComposerDrafts(observed);
    const original = invoke.getMockImplementation()!;
    try {
      invoke.mockImplementation(async (command: string, args: any) => {
        if (command === "session_set_draft") throw new Error("disk full");
        return original(command, args);
      });
      cache.clearComposerDraft("d1");
      await expect(store.flushComposerDrafts()).rejects.toThrow("disk full");
      expect(observed).not.toHaveBeenCalled();
      invoke.mockImplementation(original);
      await store.flushComposerDrafts();
      expect(observed).toHaveBeenCalledWith("d1", []);
    } finally {
      stop();
    }
  });
});

describe("actual composer persistence observation", () => {
  const attempts: { abandon(): void }[] = [];
  let currentCache: typeof cache;
  let currentStore: typeof store;
  let registry: (typeof import("./persistenceDrain"))["rendererPersistenceDrain"];
  function pending<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  function begin(id = "drain-draft") {
    const attempt = registry.beginAttempt([id]);
    attempts.push(attempt);
    return attempt;
  }
  const large = () => ({
    id: "large",
    name: "held.png",
    kind: "image" as const,
    mimeType: "image/png",
    size: 4_500_001,
    data: "A".repeat(6_000_004),
  });
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    invoke.mockReset();
    answer([]);
    currentCache = await import("../model/draftCache");
    currentStore = await import("./composerDraftStore");
    registry = (await import("./persistenceDrain")).rendererPersistenceDrain;
    await currentStore.hydrateComposerDrafts();
  });
  afterEach(async () => {
    attempts.splice(0).forEach((attempt) => attempt.abandon());
    answer([]);
    await currentStore.flushComposerDrafts();
    vi.doUnmock("./persistenceDrain");
    vi.doUnmock("../model/draftCache");
    vi.doUnmock("./sessionStore");
    vi.useRealTimers();
  });

  it("retains the draft producer through blob spill and the subsequent native draft commit", async () => {
    const blob = pending<string>();
    const committed = pending<null>();
    invoke.mockImplementation((command: string) =>
      command === "write_attachment"
        ? blob.promise
        : command === "session_set_draft"
          ? committed.promise
          : Promise.resolve([]),
    );
    currentCache.setComposerDraft("drain-draft", "preserve text and bytes");
    currentCache.setComposerAttachments("drain-draft", [large()]);
    const saving = currentStore.flushComposerDrafts();
    const attempt = begin();
    let observed = false;
    const observation = attempt.observe().then((value) => {
      observed = true;
      return value;
    });
    blob.resolve("/owned/held.png");
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toBe(false);
    expect(writes().at(-1)).toMatchObject({
      sessionId: "drain-draft",
      draft: {
        text: "preserve text and bytes",
        attachments: [{ id: "large", path: "/owned/held.png" }],
      },
    });
    committed.resolve(null);
    await saving;
    await expect(observation).resolves.toMatchObject({ qualified: false });
    attempt.assertCurrent();
  });

  it("invalidates late text but keeps and eventually saves the newest unsent draft", async () => {
    const committed = pending<null>();
    let count = 0;
    invoke.mockImplementation((command: string) =>
      command === "session_set_draft" && ++count === 1 ? committed.promise : Promise.resolve(null),
    );
    currentCache.setComposerDraft("drain-draft", "first");
    const saving = currentStore.flushComposerDrafts();
    await vi.advanceTimersByTimeAsync(0);
    const attempt = begin();
    const observation = expect(attempt.observe()).rejects.toMatchObject({ code: "late-producer" });
    currentCache.setComposerDraft("drain-draft", "new retained text");
    await observation;
    committed.resolve(null);
    await saving;
    expect(currentCache.getComposerDraft("drain-draft")).toBe("new retained text");
    expect(writes().at(-1)).toMatchObject({ draft: { text: "new retained text" } });
  });

  it("invalidates a late explicit clear without losing its empty native draft deletion", async () => {
    const blob = pending<string>();
    invoke.mockImplementation((command: string) =>
      command === "write_attachment" ? blob.promise : Promise.resolve(null),
    );
    currentCache.setComposerDraft("drain-draft", "old image");
    currentCache.setComposerAttachments("drain-draft", [large()]);
    const saving = currentStore.flushComposerDrafts();
    const attempt = begin();
    currentCache.clearComposerDraft("drain-draft");
    await expect(attempt.observe()).rejects.toMatchObject({ code: "late-producer" });
    blob.resolve("/owned/old.png");
    await saving;
    expect(writes().at(-1)).toEqual({ sessionId: "drain-draft", draft: null });
    expect(currentCache.getComposerAttachments("drain-draft")).toEqual([]);
  });

  it("retains failed spill bytes and permits a fresh strict attempt after a real full draft receipt", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "write_attachment") throw new Error("blob disk full");
      return null;
    });
    currentCache.setComposerDraft("drain-draft", "keep failed bytes");
    currentCache.setComposerAttachments("drain-draft", [large()]);
    await expect(currentStore.flushComposerDrafts()).rejects.toThrow("blob disk full");
    expect(currentCache.getComposerAttachments("drain-draft")[0].data).toHaveLength(6_000_004);
    invoke.mockImplementation(async (command: string) =>
      command === "write_attachment" ? "/owned/retried.png" : null,
    );
    await expect(begin().observe()).resolves.toMatchObject({ qualified: false });
    expect(writes().at(-1)).toMatchObject({
      draft: {
        text: "keep failed bytes",
        attachments: [{ path: "/owned/retried.png" }],
      },
    });
  });

  it("forces a native receipt when a failed commit is followed by a return to the old cached baseline", async () => {
    currentCache.setComposerDraft("drain-draft", "original");
    await currentStore.flushComposerDrafts();
    currentCache.setComposerDraft("drain-draft", "unknown commit");
    invoke.mockRejectedValueOnce(new Error("native reply lost"));
    await expect(currentStore.flushComposerDrafts()).rejects.toThrow("native reply lost");
    currentCache.setComposerDraft("drain-draft", "original");
    invoke.mockClear();
    invoke.mockResolvedValue(null);
    await expect(begin().observe()).resolves.toMatchObject({ qualified: false });
    expect(writes()).toEqual([
      { sessionId: "drain-draft", draft: { text: "original", mcpTags: [], attachments: [] } },
    ]);
  });

  it("strictly flushes only the requested draft and leaves another session's pending content intact", async () => {
    currentCache.setComposerDraft("target-draft", "target");
    currentCache.setComposerDraft("other-draft", "other retained");
    await currentStore.flushComposerDraftsStrict(["target-draft"]);
    expect(writes().map((write) => write.sessionId)).toEqual(["target-draft"]);
    expect(currentCache.getComposerDraft("other-draft")).toBe("other retained");
    await expect(begin("target-draft").observe()).resolves.toMatchObject({ qualified: false });
    expect(writes().map((write) => write.sessionId)).toEqual(["target-draft"]);
  });

  it("retains a timed-out hydrate producer until its actual attachment check and cache restore settle", async () => {
    const inspected = pending<unknown[]>();
    invoke.mockImplementation((command: string) => {
      if (command === "session_list_drafts")
        return Promise.resolve([
          saved("drain-draft", {
            text: "late restored",
            mcpTags: [],
            attachments: [
              {
                id: "file",
                name: "held.txt",
                kind: "file",
                mimeType: "text/plain",
                size: 1,
                path: "/owned/held.txt",
              },
            ],
          }),
        ]);
      if (command === "inspect_paths") return inspected.promise;
      return Promise.resolve(null);
    });
    const hydrating = currentStore.hydrateComposerDrafts();
    await vi.advanceTimersByTimeAsync(2001);
    await hydrating;
    let settled = false;
    const observation = begin()
      .observe()
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    inspected.resolve([{ path: "/owned/held.txt" }]);
    await observation;
    expect(currentCache.getComposerDraft("drain-draft")).toBe("late restored");
    expect(currentCache.getComposerAttachments("drain-draft")[0].path).toBe("/owned/held.txt");
  });

  it("preserves an old module's pending debounce and latest unsent text with a cached registry", async () => {
    const persistence = await import("./persistenceDrain");
    const sessions = await import("./sessionStore");
    currentCache.setComposerDraft("drain-draft", "old pending text");
    const retainedCache = currentCache;
    vi.resetModules();
    vi.doMock("./persistenceDrain", () => persistence);
    vi.doMock("../model/draftCache", () => retainedCache);
    vi.doMock("./sessionStore", () => sessions);
    const reloaded = await import("./composerDraftStore");
    currentCache.setComposerDraft("drain-draft", "newest unsent text");
    await expect(begin().observe()).resolves.toMatchObject({ qualified: false });
    expect(writes().at(-1)).toMatchObject({ draft: { text: "newest unsent text" } });
    expect(currentCache.getComposerDraft("drain-draft")).toBe("newest unsent text");
    await reloaded.flushComposerDraftsStrict(["drain-draft"]);
    // A full-profile flush may retire the old hook. Its surviving subscription
    // must reactivate that hook when it accepts another cache edit afterwards.
    const full = registry.beginAttempt("profile");
    attempts.push(full);
    await full.observe();
    currentCache.setComposerDraft("drain-draft", "later retained text");
    await begin().observe();
    expect(writes().at(-1)).toMatchObject({ draft: { text: "later retained text" } });
  });

  it("retains draft commit failure across module re-evaluation until an actual full native replacement", async () => {
    const persistence = await import("./persistenceDrain");
    const sessions = await import("./sessionStore");
    currentCache.setComposerDraft("drain-draft", "retained failed draft");
    invoke.mockRejectedValueOnce(new Error("old draft commit unknown"));
    await expect(currentStore.flushComposerDrafts()).rejects.toThrow("commit unknown");
    const retainedCache = currentCache;
    vi.resetModules();
    vi.doMock("./persistenceDrain", () => persistence);
    vi.doMock("../model/draftCache", () => retainedCache);
    vi.doMock("./sessionStore", () => sessions);
    const reloaded = await import("./composerDraftStore");
    await expect(reloaded.flushComposerDraftsStrict(["drain-draft"])).rejects.toThrow(
      "Unconfirmed persistence",
    );
    invoke.mockResolvedValue(null);
    await expect(begin().observe()).resolves.toMatchObject({ qualified: false });
    expect(writes().at(-1)).toMatchObject({ draft: { text: "retained failed draft" } });
  });

  it("settles concurrent incumbent flushes and a new module flush without losing the newest draft or deadlocking", async () => {
    const persistence = await import("./persistenceDrain");
    const sessions = await import("./sessionStore");
    const firstCommit = pending<null>();
    let count = 0;
    invoke.mockImplementation((command: string) =>
      command === "session_set_draft" && ++count === 1 ? firstCommit.promise : Promise.resolve([]),
    );
    currentCache.setComposerDraft("drain-draft", "incumbent text");
    const first = currentStore.flushComposerDrafts();
    const concurrent = currentStore.flushComposerDrafts();
    await vi.advanceTimersByTimeAsync(0);
    const retainedCache = currentCache;
    vi.resetModules();
    vi.doMock("./persistenceDrain", () => persistence);
    vi.doMock("../model/draftCache", () => retainedCache);
    vi.doMock("./sessionStore", () => sessions);
    const reloaded = await import("./composerDraftStore");
    invoke.mockResolvedValue(null);
    currentCache.setComposerDraft("drain-draft", "newest text");
    const newer = reloaded.flushComposerDrafts();
    const attempt = begin();
    const observation = attempt.observe();
    firstCommit.resolve(null);
    await Promise.all([first, concurrent, newer]);
    await observation;
    expect(writes().at(-1)).toMatchObject({ draft: { text: "newest text" } });
    expect(currentCache.getComposerDraft("drain-draft")).toBe("newest text");
  });

  it("retains accepted delete-to-clear lineage after the delete parent settles until the draft ACK", async () => {
    const sessions = await import("./sessionStore");
    currentCache.setComposerDraft("drain-draft", "saved before delete");
    await currentStore.flushComposerDrafts();
    const deleted = pending<null>();
    const draftAck = pending<null>();
    invoke.mockImplementation((command: string) =>
      command === "session_delete"
        ? deleted.promise
        : command === "session_set_draft"
          ? draftAck.promise
          : Promise.resolve([]),
    );
    const deleting = sessions.deleteSession("drain-draft");
    await vi.advanceTimersByTimeAsync(0);
    const attempt = begin();
    const observation = attempt.observe().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    deleted.resolve(null);
    await deleting;
    // The original delete work is already settled before its descendant timer fires.
    await vi.advanceTimersByTimeAsync(500);
    let beforeAckError: unknown;
    try {
      attempt.assertCurrent();
    } catch (error) {
      beforeAckError = error;
    }
    expect(writes().at(-1)).toEqual({ sessionId: "drain-draft", draft: null });
    draftAck.resolve(null);
    const outcome = await observation;
    expect(beforeAckError).toBeUndefined();
    expect(outcome).toMatchObject({ result: { qualified: false } });
    expect(currentCache.getComposerDraft("drain-draft")).toBeUndefined();
  });

  it("keeps pre-boundary debounce admission while a held profile write lets its timer fire", async () => {
    const sessions = await import("./sessionStore");
    const profile = pending<null>();
    const draftAck = pending<null>();
    invoke.mockImplementation((command: string) =>
      command === "workspace_set_snapshot"
        ? profile.promise
        : command === "session_set_draft"
          ? draftAck.promise
          : Promise.resolve([]),
    );
    currentCache.setComposerDraft("drain-draft", "accepted before boundary");
    const savingProfile = sessions.saveWorkspaceSnapshot({ sessionRecovery: {} });
    await vi.advanceTimersByTimeAsync(0);
    const attempt = begin();
    const observation = attempt.observe().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(501);
    let beforeAckError: unknown;
    try {
      attempt.assertCurrent();
    } catch (error) {
      beforeAckError = error;
    }
    expect(writes().at(-1)).toMatchObject({ draft: { text: "accepted before boundary" } });
    draftAck.resolve(null);
    profile.resolve(null);
    await savingProfile;
    const outcome = await observation;
    expect(beforeAckError).toBeUndefined();
    expect(outcome).toMatchObject({ result: { qualified: false } });
  });

  it("still invalidates an ordinary late clear that replaces a pre-boundary debounce, preserving its deletion", async () => {
    const sessions = await import("./sessionStore");
    currentCache.setComposerDraft("drain-draft", "previously saved");
    await currentStore.flushComposerDrafts();
    const profile = pending<null>();
    invoke.mockImplementation((command: string) =>
      command === "workspace_set_snapshot" ? profile.promise : Promise.resolve(null),
    );
    currentCache.setComposerDraft("drain-draft", "pre-boundary pending");
    const savingProfile = sessions.saveWorkspaceSnapshot({ sessionRecovery: {} });
    const attempt = begin();
    const observation = attempt.observe().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    currentCache.clearComposerDraft("drain-draft");
    await vi.advanceTimersByTimeAsync(501);
    profile.resolve(null);
    await savingProfile;
    await expect(observation).resolves.toMatchObject({ error: { code: "late-producer" } });
    expect(writes().at(-1)).toEqual({ sessionId: "drain-draft", draft: null });
    expect(currentCache.getComposerDraft("drain-draft")).toBeUndefined();
  });

  it("keeps ordinary debounce timing and its accepted root even when the timer fires before observe", async () => {
    const draftAck = pending<null>();
    invoke.mockImplementation((command: string) =>
      command === "session_set_draft" ? draftAck.promise : Promise.resolve(null),
    );
    currentCache.setComposerDraft("drain-draft", "timer-owned draft");
    const attempt = begin();
    await vi.advanceTimersByTimeAsync(499);
    expect(writes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes()).toHaveLength(1);
    const observation = attempt.observe().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    draftAck.resolve(null);
    await expect(observation).resolves.toMatchObject({ result: { qualified: false } });
    expect(writes().at(-1)).toMatchObject({ draft: { text: "timer-owned draft" } });
  });
});
