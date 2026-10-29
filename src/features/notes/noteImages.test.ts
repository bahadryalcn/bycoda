// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRecoveredNote,
  insertNoteImagesMarkdown,
  isNoteImagePath,
  noteImageMarkdown,
  type NoteImageAsset,
  saveNoteImagesFromPaths,
  saveNoteImagesFromFiles,
  noteImageApplicationErrors,
} from "./noteImages";
import {
  resolveNoteImagePath,
  peekNoteImagePath,
  deleteNote,
  invalidateNotes,
  invalidateNoteImagePaths,
} from "./notes";
import { requireNoteWork } from "./notesInputOwners";
import { beginNotesInputClosure, captureNotesInputs } from "./notesInputClosure";
import { resetNoteInputWindowForTest } from "./testing/noteInputWindow.test-support";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => resetNoteInputWindowForTest());

it("copies recovery note assets once, rewrites references and leaves generated and remote links intact", async () => {
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "notes_image_path") return "C:/app/note-assets/original/image.png";
    if (command === "notes_save_image")
      return { name: "image.png", markdownPath: `/note-assets/${args.noteId}/copy.png` };
    if (command === "notes_upsert") return { ...args.note, updatedAt: 1 };
    throw new Error(command);
  });
  const saved = await createRecoveredNote({
    title: "Recovered",
    tags: [],
    body: "![a](/note-assets/original/image.png) ![b](/note-assets/original/image.png) ![g](/generated-images/image.png) ![web](https://example.com/note-assets/original/image.png)",
  });
  expect(invoke.mock.calls.filter(([command]) => command === "notes_save_image")).toHaveLength(1);
  expect(saved.body).toBe(
    `![a](/note-assets/${saved.id}/copy.png) ![b](/note-assets/${saved.id}/copy.png) ![g](/generated-images/image.png) ![web](https://example.com/note-assets/original/image.png)`,
  );
  expect(saved.id).not.toBe("original");
  expect(invoke.mock.calls.at(-1)?.[1].note.expectedUpdatedAt).toBe(0);
});

it("does not create a recovery note when copying an asset fails", async () => {
  invoke.mockReset();
  invoke.mockRejectedValue(new Error("Missing original image"));
  await expect(
    createRecoveredNote({
      title: "Draft",
      tags: [],
      body: "![a](/note-assets/original/image.png)",
    }),
  ).rejects.toThrow("Missing original image");
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
});

it.each(["later lookup", "later copy", "upsert"])(
  "rolls back only the new attempt's images after a failed %s",
  async (failure) => {
    invoke.mockReset();
    let copiedId = "";
    let copies = 0;
    invoke.mockImplementation(async (command, args) => {
      if (command === "notes_image_path") {
        if (failure === "later lookup" && args.asset === "/note-assets/original/b.png")
          throw new Error("Missing source");
        return `C:/app${args.asset}`;
      }
      if (command === "notes_save_image") {
        copies++;
        copiedId = args.noteId;
        if (failure === "later copy" && copies === 2) throw new Error("Copy failed");
        return { name: "copy.png", markdownPath: `/note-assets/${copiedId}/${copies}.png` };
      }
      if (command === "notes_upsert") throw new Error("Save failed");
      if (command === "notes_discard_recovery_assets") return true;
      throw new Error(command);
    });
    await expect(
      createRecoveredNote({
        title: "Recovered",
        tags: [],
        body: "![a](/note-assets/original/a.png) ![b](/note-assets/original/b.png)",
      }),
    ).rejects.toThrow(
      failure === "later lookup"
        ? "Missing source"
        : failure === "later copy"
          ? "Copy failed"
          : "Save failed",
    );
    expect(copiedId).not.toBe("original");
    expect(
      invoke.mock.calls.filter(([command]) => command === "notes_discard_recovery_assets"),
    ).toEqual([["notes_discard_recovery_assets", { id: copiedId }]]);
  },
);

describe("original image display continuation", () => {
  function nativeImages() {
    invoke.mockReset().mockImplementation(async (command, args) => {
      if (command === "inspect_paths")
        return args.paths.map((path: string) => ({
          path,
          name: "image.png",
          size: 7,
          isDir: false,
        }));
      if (command === "read_file_base64") return "aW1hZ2U=";
      if (command === "notes_save_image")
        return { name: "exact image.png", markdownPath: `/note-assets/${args.noteId}/image.png` };
      if (command === "notes_image_path") return `C:/isolated${args.asset}`;
      if (command === "notes_delete") return undefined;
      throw new Error(command);
    });
  }
  it("prefetches under the original work before publishing assets and serves only fulfilled data while closed", async () => {
    nativeImages();
    const original = requireNoteWork("accepted-picker");
    const gate = beginNotesInputClosure("other-session", { owner: {}, timeoutMs: 10000 });
    try {
      const images = await saveNoteImagesFromPaths("original", ["C:/incoming/image.png"], original);
      const asset = images[0].markdownPath;
      const nativeCalls = invoke.mock.calls.length;
      expect(await resolveNoteImagePath(asset)).toBe(`C:/isolated${asset}`);
      expect(invoke.mock.calls).toHaveLength(nativeCalls);
      await expect(resolveNoteImagePath("/note-assets/other/missing.png")).rejects.toThrow(
        "Preparing checkpoint",
      );
      expect(invoke.mock.calls).toHaveLength(nativeCalls);
      // An explicit original operation still requests the actual Native grant.
      await resolveNoteImagePath(asset, original);
      expect(invoke.mock.calls.filter(([command]) => command === "notes_image_path")).toHaveLength(
        2,
      );
      original();
      const cut = await gate.capture();
      expect(cut.current()).toBe(true);
      expect(cut.snapshots.every((row) => row.snapshot.qualified === false)).toBe(true);
      cut.release();
      gate.release();
      expect(await resolveNoteImagePath(asset)).toBe(`C:/isolated${asset}`);
      expect(invoke.mock.calls.filter(([command]) => command === "notes_image_path")).toHaveLength(
        2,
      );
    } finally {
      original();
      gate.release();
    }
  });
  it("retains a successful asset separately when its actual path grant fails, without retrying the save", async () => {
    nativeImages();
    const actual = invoke.getMockImplementation()!;
    const denied = new Error("Actual path grant denied");
    invoke.mockImplementation((command, args) =>
      command === "notes_image_path" ? Promise.reject(denied) : actual(command, args),
    );
    const outcome = await saveNoteImagesFromPaths("original", ["C:/incoming/image.png"]).catch(
      (error) => error,
    );
    expect(outcome.message).toContain("Image saved; display preparation failed");
    expect(noteImageApplicationErrors(outcome).map((error) => error.asset)).toEqual([
      { name: "exact image.png", markdownPath: "/note-assets/original/image.png" },
    ]);
    expect(peekNoteImagePath("/note-assets/original/image.png")).toBeNull();
    const data = await captureNotesInputs("target");
    try {
      const rows = data.snapshots.find((row) => row.snapshot.surface === "service-intents")!
        .snapshot.records;
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: "notes_save_image",
            args: { noteId: "original", sourcePath: "C:/incoming/image.png" },
            phase: "result-application-unverified",
          }),
        ]),
      );
      expect(invoke.mock.calls.filter(([command]) => command === "notes_save_image")).toHaveLength(
        1,
      );
      expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
    } finally {
      data.release();
    }
  });
  it("bounds fulfilled display data, preserves it through note refresh, and clears only data at note deletion/profile reset", async () => {
    nativeImages();
    for (let index = 0; index < 257; index++)
      await resolveNoteImagePath(`/note-assets/owner/${index}.png`);
    expect(peekNoteImagePath("/note-assets/owner/0.png")).toBeNull();
    expect(peekNoteImagePath("/note-assets/owner/1.png")).toBeTruthy();
    invalidateNotes();
    expect(peekNoteImagePath("/note-assets/owner/1.png")).toBeTruthy();
    await resolveNoteImagePath("/note-assets/other/kept.png");
    await deleteNote("owner", 1);
    expect(peekNoteImagePath("/note-assets/owner/1.png")).toBeNull();
    expect(peekNoteImagePath("/note-assets/other/kept.png")).toBeTruthy();
    invalidateNoteImagePaths();
    expect(peekNoteImagePath("/note-assets/other/kept.png")).toBeNull();
    const gate = beginNotesInputClosure("target", { owner: {}, timeoutMs: 10000 });
    const count = invoke.mock.calls.length;
    try {
      await expect(resolveNoteImagePath("/note-assets/other/kept.png")).rejects.toThrow(
        "Preparing checkpoint",
      );
      expect(invoke.mock.calls).toHaveLength(count);
    } finally {
      gate.release();
    }
  });
  it("keeps each saved-but-unapplied asset alongside partial successes and rejects malformed path data", async () => {
    nativeImages();
    const actual = invoke.getMockImplementation()!;
    let writes = 0;
    invoke.mockImplementation((command, args) => {
      if (command === "notes_save_image")
        return Promise.resolve({
          name: `exact-${++writes}.png`,
          markdownPath: `/note-assets/original/${writes}.png`,
        });
      if (command === "notes_image_path" && args.asset.endsWith("/1.png"))
        return Promise.resolve("");
      return actual(command, args);
    });
    const images = await saveNoteImagesFromPaths("original", [
      "C:/incoming/one.png",
      "C:/incoming/two.png",
    ]);
    expect(images).toEqual([{ name: "exact-2.png", markdownPath: "/note-assets/original/2.png" }]);
    expect(noteImageApplicationErrors(images).map((error) => error.asset)).toEqual([
      { name: "exact-1.png", markdownPath: "/note-assets/original/1.png" },
    ]);
    expect(peekNoteImagePath("/note-assets/original/1.png")).toBeNull();
    expect(peekNoteImagePath("/note-assets/original/2.png")).toBeTruthy();
    const data = await captureNotesInputs("target");
    expect(
      data.snapshots.find((row) => row.snapshot.surface === "service-intents")!.snapshot.records,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "notes_save_image",
          phase: "result-application-unverified",
        }),
        expect.objectContaining({
          command: "notes_image_path",
          phase: "result-application-unverified",
        }),
      ]),
    );
    data.release();
    expect(writes).toBe(2);
  });
  it("does not republish a path from an old pending profile generation after cache reset", async () => {
    nativeImages();
    let resolve!: (path: string) => void;
    invoke.mockReturnValue(
      new Promise<string>((yes) => {
        resolve = yes;
      }),
    );
    const pending = resolveNoteImagePath("/note-assets/original/old.png");
    invalidateNoteImagePaths();
    resolve("C:/old-profile/original/old.png");
    // Preserve the actual Native outcome while retaining unverified application.
    expect(await pending).toBe("C:/old-profile/original/old.png");
    expect(peekNoteImagePath("/note-assets/original/old.png")).toBeNull();
    const data = await captureNotesInputs("target");
    expect(
      data.snapshots.find((row) => row.snapshot.surface === "service-intents")!.snapshot.records,
    ).toEqual([
      expect.objectContaining({
        command: "notes_image_path",
        phase: "result-application-unverified",
      }),
    ]);
    data.release();
    expect(invoke).toHaveBeenCalledOnce();
  });
  it("preserves the first saved image when the next real PNG temporary conversion fails, without retrying either input", async () => {
    const failed = new Error("Second temporary image write refused");
    let converted = 0;
    invoke.mockReset().mockImplementation(async (command, args) => {
      if (command === "write_attachment") {
        if (++converted === 2) throw failed;
        return "C:/isolated/incoming-one.png";
      }
      if (command === "notes_save_image")
        return { name: "one.png", markdownPath: "/note-assets/original/one.png" };
      if (command === "notes_image_path") return "C:/isolated/note-assets/original/one.png";
      if (command === "delete_path") return undefined;
      throw new Error(`${command}:${JSON.stringify(args)}`);
    });
    const files = [
      new File([new Uint8Array([1, 2, 3])], "one.png", { type: "image/png" }),
      new File([new Uint8Array([4, 5, 6])], "two.png", { type: "image/png" }),
    ];
    const assets = await saveNoteImagesFromFiles("original", files);
    expect(assets).toEqual([{ name: "one.png", markdownPath: "/note-assets/original/one.png" }]);
    expect(insertNoteImagesMarkdown("exact original", 5, 5, assets).value).toContain(
      "![one.png](/note-assets/original/one.png)",
    );
    expect(invoke.mock.calls.filter(([command]) => command === "write_attachment")).toHaveLength(2);
    expect(invoke.mock.calls.filter(([command]) => command === "notes_save_image")).toEqual([
      ["notes_save_image", { noteId: "original", sourcePath: "C:/isolated/incoming-one.png" }],
    ]);
    expect(invoke.mock.calls.filter(([command]) => command === "notes_image_path")).toHaveLength(1);
    expect(invoke.mock.calls.filter(([command]) => command === "delete_path")).toEqual([
      ["delete_path", { path: "C:/isolated/incoming-one.png" }],
    ]);
    expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  });
  it("preserves the original temporary conversion rejection when no image was saved", async () => {
    const failed = new Error("Actual temporary conversion refused");
    invoke.mockReset().mockRejectedValue(failed);
    await expect(
      saveNoteImagesFromFiles("original", [
        new File([new Uint8Array([1, 2, 3])], "one.png", { type: "image/png" }),
      ]),
    ).rejects.toBe(failed);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["write_attachment"]);
  });
});

it("reports failed rollback without hiding the original recovery failure", async () => {
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "notes_image_path") return "C:/app/original.png";
    if (command === "notes_save_image")
      return { name: "copy.png", markdownPath: `/note-assets/${args.noteId}/copy.png` };
    if (command === "notes_upsert") throw new Error("Save failed");
    throw new Error("Cleanup failed");
  });
  await expect(
    createRecoveredNote({
      title: "Recovered",
      tags: [],
      body: "![a](/note-assets/original/a.png)",
    }),
  ).rejects.toThrow(/Save failed[\s\S]*Cleanup failed/);
});

const image: NoteImageAsset = {
  name: "Architecture [draft].png",
  markdownPath: "/note-assets/note-1/123-architecture-draft.png",
};

describe("note image markdown", () => {
  it("escapes image names used as alt text", () => {
    expect(noteImageMarkdown(image)).toBe(
      "![Architecture \\[draft\\].png](/note-assets/note-1/123-architecture-draft.png)",
    );
  });

  it("inserts images as blocks at the cursor", () => {
    expect(insertNoteImagesMarkdown("BeforeAfter", 6, 6, [image])).toEqual({
      value:
        "Before\n\n![Architecture \\[draft\\].png](/note-assets/note-1/123-architecture-draft.png)\n\nAfter",
      cursor: 85,
    });
  });

  it("replaces the selection and separates multiple images", () => {
    const second = {
      name: "flow.png",
      markdownPath: "/note-assets/note-1/456-flow.png",
    };
    expect(insertNoteImagesMarkdown("Top\nreplace\nBottom", 4, 12, [image, second])).toEqual({
      value: [
        "Top",
        "",
        noteImageMarkdown(image),
        "",
        noteImageMarkdown(second),
        "",
        "Bottom",
      ].join("\n"),
      cursor: 129,
    });
  });

  it("recognizes only note asset references", () => {
    expect(isNoteImagePath(image.markdownPath)).toBe(true);
    expect(isNoteImagePath("https://example.com/image.png")).toBe(false);
  });
});
