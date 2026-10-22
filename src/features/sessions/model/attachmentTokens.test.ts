import { describe, expect, it } from "vitest";
import {
  attachmentLegend,
  attachmentTokens,
  attachmentsDroppedByEdit,
  deleteTokenAtCaret,
  findTokens,
  insertAtSelection,
  removeAttachmentFromText,
  splitAttachmentTokens,
  stripAttachmentTokens,
  tokenLabel,
  tokensForIncoming,
} from "./attachmentTokens";
import type { Attachment } from "./session";

function make(kind: Attachment["kind"], name: string, path?: string): Attachment {
  return {
    id: name,
    name,
    kind,
    mimeType: kind === "image" ? "image/png" : "text/plain",
    size: 1,
    ...(path ? { path } : {}),
  };
}

const image = (name = "a.png") => make("image", name);
const doc = (name = "a.md") => make("file", name);

describe("attachmentTokens", () => {
  it("numbers images and other files separately, in the order given", () => {
    const files = [image(), doc(), image(), make("audio", "a.wav"), doc()];
    expect(attachmentTokens(files)).toEqual([
      "[image1]",
      "[file1]",
      "[image2]",
      "[file2]",
      "[file3]",
    ]);
    expect(attachmentTokens([])).toEqual([]);
    expect(tokenLabel("[image12]")).toBe("image12");
  });

  it("gives incoming files the next numbers after the ones already there", () => {
    expect(tokensForIncoming([image(), doc()], [image(), image()])).toBe("[image2] [image3]");
    expect(tokensForIncoming([], [doc(), image()])).toBe("[file1] [image1]");
  });
});

describe("findTokens", () => {
  const files = [image(), image(), doc()];

  it("finds tokens of attachments that exist, with their attachment index", () => {
    const text = "see [image2] and [file1], not [image3] or [file2]";
    expect(findTokens(text, files).map((m) => [m.token, m.index])).toEqual([
      ["[image2]", 1],
      ["[file1]", 2],
    ]);
  });

  it("leaves tokens glued to a word alone, so index expressions stay code", () => {
    expect(findTokens("arr[image1] and x_[image1] and $[image1]", files)).toEqual([]);
    expect(findTokens("(see [image1])", files)).toHaveLength(1);
    expect(findTokens("line one\n[image1]", files)).toHaveLength(1);
  });

  it("leaves tokens in inline code and fenced blocks alone", () => {
    const text = "use `[image1]` here,\n```\n[image1]\n[image2]\n```\nbut [image2] counts";
    expect(findTokens(text, files).map((m) => m.start)).toEqual([text.lastIndexOf("[image2]")]);
    // An unclosed fence swallows the rest, as markdown does.
    expect(findTokens("```\n[image1]", files)).toEqual([]);
  });

  it.each([
    "``[image1] ` [image2]``",
    "````[image1] ``` [image2]````",
    "`[image1]\n[image2]`",
    "~~~markdown\n[image1]\n[image2]\n~~~",
    "````markdown\n```\n[image1]\n[image2]\n````",
    "~~~~\n~~~\n[image1]\n[image2]\n~~~~",
    "    [image1]\n    [image2]",
  ])("preserves literal Markdown code through token operations: %s", (code) => {
    const text = `${code}\n\n[image2]`;
    expect(findTokens(text, files).map((match) => match.start)).toEqual([
      text.lastIndexOf("[image2]"),
    ]);
    expect(removeAttachmentFromText(text, files, 0)).toBe(`${code}\n\n[image1]`);
    expect(stripAttachmentTokens(text, files)).toBe(`${code}\n\n`);
    expect(
      deleteTokenAtCaret(text, code.indexOf("[image1]") + "[image1]".length, "back", files),
    ).toBeNull();
  });

  it("matches the exact token only", () => {
    expect(findTokens("[Image1] [image0] [image01] [image 1] [img1]", files)).toEqual([]);
    expect(findTokens("[image1]", [])).toEqual([]);
  });
  it("protects an unclosed tilde fence through the end of the draft", () => {
    const text = "~~~\n[image1]\n[image2]";
    expect(findTokens(text, files)).toEqual([]);
    expect(removeAttachmentFromText(text, files, 0)).toBe(text);
  });
});

describe("insertAtSelection", () => {
  it("appends at the end without a caret, spacing only after a word", () => {
    expect(insertAtSelection("fix it", null, "[image1]")).toEqual({
      text: "fix it [image1]",
      caret: 15,
    });
    expect(insertAtSelection("fix it ", null, "[image1]").text).toBe("fix it [image1]");
    expect(insertAtSelection("", null, "[image1]")).toEqual({
      text: "[image1]",
      caret: 8,
    });
  });

  it("inserts at the start of the text", () => {
    expect(insertAtSelection("fix it", { start: 0, end: 0 }, "[image1]")).toEqual({
      text: "[image1] fix it",
      caret: 9,
    });
  });

  it("splits a word instead of fusing with it, and respects spaces already there", () => {
    expect(insertAtSelection("fixit", { start: 3, end: 3 }, "[image1]").text).toBe(
      "fix [image1] it",
    );
    expect(insertAtSelection("fix it", { start: 3, end: 3 }, "[image1]").text).toBe(
      "fix [image1] it",
    );
    expect(insertAtSelection("fix  it", { start: 4, end: 4 }, "[image1]").text).toBe(
      "fix [image1] it",
    );
  });

  it("does not push a space in front of punctuation", () => {
    expect(insertAtSelection("see this.", { start: 8, end: 8 }, "[image1]").text).toBe(
      "see this [image1].",
    );
  });

  it("replaces the selection", () => {
    expect(insertAtSelection("the button here", { start: 4, end: 10 }, "[image1]")).toEqual({
      text: "the [image1] here",
      caret: 12,
    });
  });

  it("clamps a stale selection to the text", () => {
    expect(insertAtSelection("ab", { start: 9, end: 12 }, "[file1]").text).toBe("ab [file1]");
  });
});

describe("removeAttachmentFromText", () => {
  it("drops every occurrence and tidies the doubled space", () => {
    const files = [image(), doc()];
    expect(removeAttachmentFromText("a [image1] b [image1] c [file1]", files, 0)).toBe(
      "a b c [file1]",
    );
    expect(removeAttachmentFromText("[image1] fix", files, 0)).toBe("fix");
    expect(removeAttachmentFromText("fix [image1]", files, 0)).toBe("fix");
    expect(removeAttachmentFromText("fix [image1].", files, 0)).toBe("fix.");
    expect(removeAttachmentFromText("a [image1]\nb", files, 0)).toBe("a\nb");
  });

  it("renumbers the attachments left behind", () => {
    const files = [image(), image(), image()];
    const text = "[image1] and [image2] and [image3]";
    expect(removeAttachmentFromText(text, files, 0)).toBe("and [image1] and [image2]");
    expect(removeAttachmentFromText(text, files, 1)).toBe("[image1] and and [image2]");
  });

  it("renumbers in one pass, so a renamed token is never renamed again", () => {
    const files = [image(), image(), image()];
    expect(removeAttachmentFromText("[image3] [image2] [image1]", files, 0)).toBe(
      "[image2] [image1]",
    );
  });

  it("handles [image1] [image2] [image10] and keeps kinds apart", () => {
    const files = [...Array.from({ length: 10 }, (_, i) => image(`${i}.png`)), doc()];
    const text = "[image1] [image2] [image10] [file1]";
    expect(removeAttachmentFromText(text, files, 0)).toBe("[image1] [image9] [file1]");
    expect(removeAttachmentFromText(text, files, 9)).toBe("[image1] [image2] [file1]");
    // Removing a file never touches the image numbering, and vice versa.
    expect(removeAttachmentFromText(text, files, 10)).toBe("[image1] [image2] [image10]");
    const mixed = [image(), doc("a"), doc("b")];
    expect(removeAttachmentFromText("[file1] [file2]", mixed, 1)).toBe("[file1]");
    expect(removeAttachmentFromText("[file1] [file2]", mixed, 2)).toBe("[file1]");
    expect(removeAttachmentFromText("[file1] [file2]", mixed, 0)).toBe("[file1] [file2]");
  });

  it("leaves tokens for attachments that do not exist, and code, as written", () => {
    const files = [image(), image()];
    expect(removeAttachmentFromText("[image1] [image7] `[image2]` arr[image2]", files, 0)).toBe(
      "[image7] `[image2]` arr[image2]",
    );
  });

  it("returns the text unchanged for an unknown index", () => {
    expect(removeAttachmentFromText("[image1]", [image()], 3)).toBe("[image1]");
    expect(removeAttachmentFromText("[image1]", [image()], -1)).toBe("[image1]");
  });
});

describe("attachmentsDroppedByEdit", () => {
  const files = [image(), doc(), image("b.png")];

  it("reports a token the edit deleted", () => {
    expect(attachmentsDroppedByEdit("a [image1] [file1] b", "a [file1] b", files)).toEqual([0]);
  });

  it("reports every token a select-all delete took", () => {
    expect(attachmentsDroppedByEdit("[image1] [file1] [image2]", "", files).sort()).toEqual([
      0, 1, 2,
    ]);
  });

  it("counts a token broken by typing inside it as removed", () => {
    expect(attachmentsDroppedByEdit("[image1]", "[imagX1]", files)).toEqual([0]);
  });

  it("keeps an attachment whose token is still there", () => {
    expect(attachmentsDroppedByEdit("[image1]", "x[image1]", files)).toEqual([]);
    expect(attachmentsDroppedByEdit("[image1] a", "[image1] ab", files)).toEqual([]);
  });

  it("ignores tokens that were not references before the edit", () => {
    expect(attachmentsDroppedByEdit("[image9] `[image1]`", "", files)).toEqual([]);
    expect(attachmentsDroppedByEdit("text", "", files)).toEqual([]);
  });
});

describe("deleteTokenAtCaret", () => {
  const files = [image(), doc()];

  it("Backspace right after the token takes all of it", () => {
    expect(deleteTokenAtCaret("a [image1]", 10, "back", files)).toEqual({
      text: "a ",
      caret: 2,
    });
  });

  it("Delete right before the token takes all of it", () => {
    expect(deleteTokenAtCaret("[file1]x", 0, "forward", files)).toEqual({
      text: "x",
      caret: 0,
    });
  });

  it("drops one space when the token sat between two", () => {
    expect(deleteTokenAtCaret("a [image1] b", 10, "back", files)).toEqual({
      text: "a b",
      caret: 2,
    });
  });

  it("does nothing away from a token or on the wrong side", () => {
    expect(deleteTokenAtCaret("[image1]", 8, "forward", files)).toBeNull();
    expect(deleteTokenAtCaret("[image1]", 0, "back", files)).toBeNull();
    expect(deleteTokenAtCaret("[image1] x", 9, "back", files)).toBeNull();
    expect(deleteTokenAtCaret("[image7]", 8, "back", files)).toBeNull();
  });
});

describe("stripAttachmentTokens / splitAttachmentTokens", () => {
  const files = [image("shot.png"), doc("notes.md")];

  it("strips only tokens that name an attachment", () => {
    expect(stripAttachmentTokens("[image1] [file1] [image9]", files)).toBe("[image9]");
  });

  it("cuts text into runs and token segments", () => {
    const segments = splitAttachmentTokens("look at [image1], then [file1]", files);
    expect(segments).toEqual([
      { text: "look at " },
      { token: "[image1]", label: "image1", attachment: files[0] },
      { text: ", then " },
      { token: "[file1]", label: "file1", attachment: files[1] },
    ]);
    expect(splitAttachmentTokens("no tokens", files)).toEqual([{ text: "no tokens" }]);
  });
});

describe("attachmentLegend", () => {
  it("is empty when nothing is attached", () => {
    expect(attachmentLegend([])).toBe("");
  });

  it("maps each token to its attachment", () => {
    expect(
      attachmentLegend([
        image("screenshot.png"),
        make("file", "App.tsx", "src/app/App.tsx"),
        image("two.png"),
      ]),
    ).toBe(
      "Attachments: [image1] = screenshot.png (1st attached image), [file1] = src/app/App.tsx, [image2] = two.png (2nd attached image)",
    );
  });

  it("falls back to the name when a file has no path, and keeps it on one line", () => {
    expect(attachmentLegend([make("audio", "voice\nnote.wav")])).toBe(
      "Attachments: [file1] = voice note.wav",
    );
  });

  it("writes ordinals for any count", () => {
    const legend = attachmentLegend(Array.from({ length: 23 }, (_, i) => image(`${i}.png`)));
    for (const ordinal of [
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
    ]) {
      expect(legend).toContain(`(${ordinal} attached image)`);
    }
  });
});
