import { describe, expect, it } from "vitest";
import { MAX_PERSISTED_ATTACHMENT_CHARS } from "./queuePersistence";
import {
  canRestoreOver,
  droppedAttachmentsNotice,
  persistableDraft,
  composerDraftBytes,
  COMPOSER_DRAFT_MAX_BYTES,
  restoreDraft,
  settleRestoredDraft,
  type ComposerDraft,
} from "./draftPersistence";
import type { Attachment } from "./session";

const image = (over: Partial<Attachment> = {}): Attachment => ({
  id: "a1",
  name: "shot.png",
  mimeType: "image/png",
  kind: "image",
  size: 10,
  data: "AAAA",
  previewUrl: "blob:gone",
  ...over,
});

const tag = {
  token: "@mcp/files",
  server: { name: "files", provider: "claude", scope: "user" },
};

const draft = (over: Partial<ComposerDraft> = {}): ComposerDraft => ({
  text: "look at [image1]",
  mcpTags: [],
  attachments: [image()],
  ...over,
});

const allPresent = async (paths: string[]) => new Set(paths);
const nonePresent = async () => new Set<string>();

describe("persistableDraft", () => {
  it("bounds combined inline images while retaining explicit recovery metadata", () => {
    const saved = persistableDraft(
      draft({
        attachments: [
          image({ data: "A".repeat(4_500_000) }),
          image({ id: "a2", data: "B".repeat(4_500_000) }),
        ],
      }),
    )!;
    expect(composerDraftBytes(saved)).toBeLessThanOrEqual(COMPOSER_DRAFT_MAX_BYTES);
    expect(saved.attachments).toHaveLength(2);
    expect(saved.attachments.some((file) => file.missing && !file.data)).toBe(true);
  });

  it("round-trips the non-agent intent and ignores unknown modes", () => {
    const saved = persistableDraft(draft({ mode: "save" }));
    expect(restoreDraft(saved)?.mode).toBe("save");
    expect(restoreDraft({ ...saved, mode: "unknown" })?.mode).toBeUndefined();
  });
  it("keeps text, tags and attachments but not object URLs", () => {
    const saved = persistableDraft(draft({ mcpTags: [tag as never] }));
    expect(saved?.text).toBe("look at [image1]");
    expect(saved?.mcpTags).toHaveLength(1);
    expect(saved?.attachments[0]).not.toHaveProperty("previewUrl");
    expect(saved?.attachments[0].data).toBe("AAAA");
  });

  it("has nothing to keep for an empty draft", () => {
    expect(persistableDraft(draft({ text: "  ", attachments: [] }))).toBeNull();
    expect(
      persistableDraft(draft({ text: "", attachments: [], mcpTags: [tag as never] })),
    ).toBeNull();
  });

  it("keeps an attachment-only draft", () => {
    expect(persistableDraft(draft({ text: "" }))).not.toBeNull();
  });

  it("marks a pasted image too large to store as missing", () => {
    const big = image({ data: "x".repeat(MAX_PERSISTED_ATTACHMENT_CHARS + 1) });
    const saved = persistableDraft(draft({ attachments: [big] }));
    expect(saved?.attachments[0]).toMatchObject({ missing: true });
    expect(saved?.attachments[0].data).toBeUndefined();
  });

  it("keeps only the path of a file attachment", () => {
    const file = image({ id: "f1", path: "/tmp/a.png", data: "BBBB" });
    const saved = persistableDraft(draft({ attachments: [file] }));
    expect(saved?.attachments[0].path).toBe("/tmp/a.png");
    expect(saved?.attachments[0].data).toBeUndefined();
  });
});

describe("restoreDraft", () => {
  it("round-trips what persistableDraft wrote", () => {
    const saved = persistableDraft(draft({ mcpTags: [tag as never] }));
    expect(restoreDraft(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("drops anything that does not fit instead of throwing", () => {
    expect(restoreDraft(null)).toBeNull();
    expect(restoreDraft("text")).toBeNull();
    expect(restoreDraft({ text: 5 })).toBeNull();
    expect(restoreDraft({ text: "" })).toBeNull();
    const restored = restoreDraft({
      text: "hi",
      attachments: [{ id: 1 }, "x"],
      mcpTags: [{ token: "" }, { token: "@mcp/a" }, tag],
    });
    expect(restored).toEqual({ text: "hi", attachments: [], mcpTags: [tag] });
  });
});

describe("settleRestoredDraft", () => {
  const onDisk = (): ComposerDraft =>
    draft({
      text: "see [file1] and [image1]",
      attachments: [
        image({
          id: "f",
          name: "notes.txt",
          kind: "file",
          path: "/tmp/notes.txt",
          data: undefined,
        }),
        image({ id: "i", name: "pasted.png" }),
      ],
    });

  it("keeps everything when the files are still there", async () => {
    const result = await settleRestoredDraft(onDisk(), allPresent);
    expect(result?.dropped).toEqual([]);
    expect(result?.draft.attachments).toHaveLength(2);
    expect(result?.draft.text).toBe("see [file1] and [image1]");
  });

  it("drops a gone file with its token and renumbers the rest", async () => {
    const result = await settleRestoredDraft(onDisk(), nonePresent);
    expect(result?.dropped).toEqual(["notes.txt"]);
    expect(result?.draft.attachments.map((file) => file.id)).toEqual(["i"]);
    expect(result?.draft.text).not.toContain("[file1]");
    expect(result?.draft.text).toContain("[image1]");
  });

  it("drops an attachment saved as missing", async () => {
    const lost = draft({ attachments: [image({ missing: true, data: undefined })] });
    const result = await settleRestoredDraft(lost, allPresent);
    expect(result?.dropped).toEqual(["shot.png"]);
    expect(result?.draft.attachments).toEqual([]);
    expect(result?.draft.text).toBe("look at");
  });

  it("keeps the draft as it was when the check itself fails", async () => {
    const result = await settleRestoredDraft(onDisk(), async () => {
      throw new Error("ipc");
    });
    expect(result?.dropped).toEqual([]);
    expect(result?.draft.attachments).toHaveLength(2);
  });

  it("reports the loss even when nothing is left of the draft", async () => {
    const only = draft({ text: "[image1]", attachments: [image({ missing: true })] });
    const result = await settleRestoredDraft(only, allPresent);
    expect(result?.dropped).toEqual(["shot.png"]);
    expect(result?.draft.text.trim()).toBe("");
  });
});

describe("droppedAttachmentsNotice", () => {
  it("is empty when nothing was dropped and names what was", () => {
    expect(droppedAttachmentsNotice([])).toBe("");
    expect(droppedAttachmentsNotice(["a.png"])).toContain("a.png");
    expect(droppedAttachmentsNotice(["a", "b", "c", "d", "e"])).toContain("and 2 more");
  });
});

describe("canRestoreOver", () => {
  it("only restores into an empty slot, so typed text is never clobbered", () => {
    expect(canRestoreOver({})).toBe(true);
    expect(canRestoreOver({ text: "", attachments: [] })).toBe(true);
    expect(canRestoreOver({ text: "typed" })).toBe(false);
    expect(canRestoreOver({ attachments: [image()] })).toBe(false);
  });
});
