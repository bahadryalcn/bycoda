import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ONLY_PROMPT,
  MAX_ATTACHMENTS,
  displayAttachments,
  filesFromClipboard,
  mergeAttachments,
  persistableAttachment,
  promptText,
} from "./attachments";
import { attachmentTokens } from "./attachmentTokens";
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

describe("mergeAttachments", () => {
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
    const expected = ["[image1]", "[file1]", "[image2]"];
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
    expect(attachmentTokens(merged)).toEqual(["[image1]", "[file1]", "[image2]"]);
  });
});

describe("promptText", () => {
  const image = attachment({ id: "a", name: "shot.png" });

  it("adds the legend after the message when there are attachments", () => {
    expect(promptText("  fix [image1]  ", [image])).toBe(
      "fix [image1]\n\nAttachments: [image1] = shot.png (1st attached image)",
    );
  });

  it("adds no legend without attachments, and leaves tokens-looking text alone", () => {
    expect(promptText("  fix [image1]  ")).toBe("fix [image1]");
    expect(promptText("   ")).toBe("");
  });

  it("treats a message of only tokens as attachment-only", () => {
    const legend = "Attachments: [image1] = shot.png (1st attached image)";
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
