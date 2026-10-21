import { describe, expect, it, vi } from "vitest";
import {
  createRecoveredNote,
  insertNoteImagesMarkdown,
  isNoteImagePath,
  noteImageMarkdown,
  type NoteImageAsset,
} from "./noteImages";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

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
        if (failure === "later lookup" && copies === 1) throw new Error("Missing source");
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
