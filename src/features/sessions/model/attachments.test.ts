import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ONLY_PROMPT,
  attachmentPreviewSrc,
  MAX_ATTACHMENTS,
  displayAttachments,
  filesFromClipboard,
  mergeAttachments,
  persistableAttachment,
  promptText,
} from "./attachments";
import { attachmentTokens } from "./attachmentTokens";
import { beginAttachmentRead } from "./attachmentReadCapacity";
import { titleFromPrompt } from "./session";
import type { Attachment } from "./session";

function file(name: string, type: string, body = "x") {
  return new File([body], name, { type });
}

function item(next: File): {
  kind: string;
  type: string;
  getAsFile: () => File | null;
} {
  return {
    kind: "file",
    type: next.type,
    getAsFile: () => next,
  };
}

function attachment(partial: Partial<Attachment> & Pick<Attachment, "id" | "name">): Attachment {
  return {
    mimeType: "image/png",
    kind: "image",
    size: 4,
    ...partial,
  };
}

/** The generated token form: words joined by no-break spaces, then the size. */
const tok = (kind: "Image" | "File", n: number, size: string) =>
  `[${kind}\u00a0${n}\u00a0·\u00a0${size.replace(" ", "\u00a0")}]`;

describe("mergeAttachments", () => {
  it("reserves a local path once even when another drop arrives before its thumbnail", () => {
    const existing = [
      attachment({
        id: "remote",
        name: "shot.png",
        path: "/shot.png",
        hostEnvironmentId: "other-host",
      }),
    ];
    const slots = new Set<string | symbol>();
    const first = beginAttachmentRead(() => existing, slots);
    const second = beginAttachmentRead(() => existing, slots);
    expect(first.reserve("/shot.png")).toBe("/shot.png");
    expect(second.reserve("/shot.png")).toBeNull();
    expect(second.matchedPendingPath).toBe(true);
    expect(second.notice()).toBeNull();
    second.finish();
    expect(first.remaining()).toBe(MAX_ATTACHMENTS - 2);
    first.finish();
    expect(second.reserve("/shot.png")).toBe("/shot.png");
  });
  it.each([undefined, "other-host"])(
    "keeps same-spelling paths from different hosts (%s)",
    (hostEnvironmentId) => {
      const first = attachment({
        id: "remote",
        name: "report.txt",
        path: "/repo/report.txt",
        hostEnvironmentId: "remote-host",
      });
      const second = { ...first, id: "incoming", hostEnvironmentId };
      expect(mergeAttachments([first], [second])).toEqual([first, second]);
      expect(mergeAttachments([first], [{ ...first, id: "duplicate" }])).toEqual([first]);
      expect(mergeAttachments([first], [{ ...second, id: first.id }])).toEqual([first]);
    },
  );
  it("does not exceed capacity when the existing draft is already full", () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, (_, index) =>
      attachment({ id: `existing-${index}`, name: `${index}.png` }),
    );
    const next = attachment({ id: "extra", name: "extra.png" });
    expect(mergeAttachments(existing, [next])).toEqual(existing);
    expect(mergeAttachments(existing.slice(1), [next, { ...next, id: "extra-2" }])).toHaveLength(
      MAX_ATTACHMENTS,
    );
  });
  it("keeps previously attached images when adding more", () => {
    const first = attachment({ id: "a", name: "one.png" });
    const second = attachment({ id: "b", name: "two.png" });
    expect(mergeAttachments([first], [second]).map((file) => file.id)).toEqual(["a", "b"]);
  });

  it("skips the same path twice", () => {
    const first = attachment({
      id: "a",
      name: "shot.png",
      path: "/tmp/shot.png",
    });
    const again = attachment({
      id: "b",
      name: "shot.png",
      path: "/tmp/shot.png",
    });
    expect(mergeAttachments([first], [again])).toEqual([first]);
  });
});

describe("attachment order, which numbers the tokens", () => {
  const files = [
    attachment({ id: "a", name: "one.png", path: "/tmp/one.png" }),
    attachment({ id: "b", name: "notes.md", kind: "file" }),
    attachment({ id: "c", name: "two.png", data: "YWJj" }),
  ];

  it("keeps the order through merging, persisting and display", () => {
    const expected = [tok("Image", 1, "4 B"), tok("File", 1, "4 B"), tok("Image", 2, "4 B")];
    expect(attachmentTokens(mergeAttachments([files[0]], files.slice(1)))).toEqual(expected);
    expect(attachmentTokens(files.map(persistableAttachment))).toEqual(expected);
    expect(displayAttachments(files).map((file) => file.id)).toEqual(["a", "b", "c"]);
  });

  it("does not shift a token when a duplicate is skipped", () => {
    const again = attachment({
      id: "z",
      name: "one.png",
      path: "/tmp/one.png",
    });
    const merged = mergeAttachments(files, [again]);
    expect(merged).toEqual(files);
    expect(attachmentTokens(merged)).toEqual([
      tok("Image", 1, "4 B"),
      tok("File", 1, "4 B"),
      tok("Image", 2, "4 B"),
    ]);
  });
});

describe("promptText", () => {
  const image = attachment({ id: "a", name: "shot.png" });

  it("adds the legend after the message when there are attachments", () => {
    expect(promptText("  fix [image1]  ", [image])).toBe(
      `fix [image1]\n\nAttachments: ${tok("Image", 1, "4 B")} = shot.png (1st attached image)`,
    );
  });

  it("adds no legend without attachments, and leaves tokens-looking text alone", () => {
    expect(promptText("  fix [image1]  ")).toBe("fix [image1]");
    expect(promptText("   ")).toBe("");
  });

  it("treats a message of only tokens as attachment-only", () => {
    const legend = `Attachments: ${tok("Image", 1, "4 B")} = shot.png (1st attached image)`;
    expect(promptText("[image1]", [image])).toBe(`${ATTACHMENT_ONLY_PROMPT}\n\n${legend}`);
    expect(promptText("", [image])).toBe(`${ATTACHMENT_ONLY_PROMPT}\n\n${legend}`);
    // A token for an attachment that is not there is still the user's text.
    expect(promptText("[image2]", [image])).toBe(`[image2]\n\n${legend}`);
  });

  it("is not applied twice: the stored message never holds the legend", () => {
    const once = promptText("look", [image]);
    expect(once.match(/Attachments:/g)).toHaveLength(1);
    // Resending the stored text builds the same prompt, not a doubled one.
    expect(promptText("look", [image])).toBe(once);
  });
});

describe("titleFromPrompt with tokens", () => {
  it("titles a message that only points at its files by their names", () => {
    const image = attachment({ id: "a", name: "shot.png" });
    expect(titleFromPrompt("[image1]", "claude", [image])).toBe(
      titleFromPrompt("", "claude", [image]),
    );
    expect(titleFromPrompt("fix [image1]", "claude", [image])).toContain("fix [image1]");
  });
});

describe("filesFromClipboard", () => {
  it("returns every file item when the files list is truncated", () => {
    const a = file("a.png", "image/png", "a");
    const b = file("b.png", "image/png", "b");
    expect(
      filesFromClipboard({
        files: [a],
        items: [item(a), item(b)],
      }),
    ).toEqual([a, b]);
  });

  it("drops the unnamed tiff twin of a png screenshot", () => {
    const png = file("image.png", "image/png");
    const tiff = file("image.tiff", "image/tiff");
    expect(
      filesFromClipboard({
        files: [png],
        items: [item(png), item(tiff)],
      }),
    ).toEqual([png]);
  });

  it("keeps a real named tiff next to a png", () => {
    const png = file("diagram.png", "image/png");
    const tiff = file("scan.tiff", "image/tiff");
    expect(
      filesFromClipboard({
        files: [png, tiff],
        items: [item(png), item(tiff)],
      }),
    ).toEqual([png, tiff]);
  });
});

describe("attachmentPreviewSrc", () => {
  it("returns the same data URL reference for the same attachment", () => {
    const image = attachment({ id: "img-1", name: "a.png", data: "AAAA" });
    const first = attachmentPreviewSrc(image);
    expect(first).toBe("data:image/png;base64,AAAA");
    expect(attachmentPreviewSrc(image)).toBe(first);
  });

  it("builds a new URL when the attachment data or type changes", () => {
    const image = attachment({ id: "img-2", name: "b.png", data: "AAAA" });
    const first = attachmentPreviewSrc(image);
    image.data = "BBBB";
    expect(attachmentPreviewSrc(image)).toBe("data:image/png;base64,BBBB");
    image.mimeType = "image/jpeg";
    expect(attachmentPreviewSrc(image)).toBe("data:image/jpeg;base64,BBBB");
    expect(attachmentPreviewSrc(image)).not.toBe(first);
  });

  it("falls back to the preview URL for non-image or dataless attachments", () => {
    expect(
      attachmentPreviewSrc(attachment({ id: "f", name: "a.txt", kind: "file" })),
    ).toBeUndefined();
    expect(attachmentPreviewSrc(attachment({ id: "p", name: "p.png", previewUrl: "blob:p" }))).toBe(
      "blob:p",
    );
  });
});
