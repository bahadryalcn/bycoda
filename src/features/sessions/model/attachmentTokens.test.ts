import { describe, expect, it } from "vitest";
import {
  attachmentLegend,
  attachmentDraftTokens,
  compactAttachmentDraftTokens,
  expandAttachmentDraftTokens,
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

const NBSP = "\u00a0";
/** The generated token form; the test attachments are 1 byte each. */
const tok = (kind: "Image" | "File", n: number, size = "1 B") =>
  `[${kind}${NBSP}${n}${NBSP}·${NBSP}${size.replace(" ", NBSP)}]`;

const image = (name = "a.png") => make("image", name);
const doc = (name = "a.md") => make("file", name);

describe("attachmentTokens", () => {
  it("numbers images and other files separately, in the order given", () => {
    const files = [image(), doc(), image(), make("audio", "a.wav"), doc()];
    expect(attachmentTokens(files)).toEqual([
      tok("Image", 1),
      tok("File", 1),
      tok("Image", 2),
      tok("File", 2),
      tok("File", 3),
    ]);
    expect(attachmentTokens([])).toEqual([]);
    expect(tokenLabel(tok("Image", 12))).toBe(`Image${NBSP}12${NBSP}·${NBSP}1${NBSP}B`);
  });

  it("writes the size with the shared format and leaves it out when unknown", () => {
    const sized = (kind: Attachment["kind"], size: number) => ({ ...make(kind, "x"), size });
    expect(
      attachmentTokens([
        sized("image", 54 * 1024),
        sized("file", 5 * 1024),
        sized("file", 1536 * 1024),
        sized("image", 0),
        sized("file", Number.NaN),
      ]),
    ).toEqual([
      tok("Image", 1, "54 KB"),
      tok("File", 1, "5 KB"),
      tok("File", 2, "1.5 MB"),
      `[Image${NBSP}2]`,
      `[File${NBSP}3]`,
    ]);
  });

  it("gives incoming files the next numbers after the ones already there", () => {
    const [file, first, second, third] = attachmentDraftTokens([doc(), image(), image(), image()]);
    expect(tokensForIncoming([image(), doc()], [image(), image()])).toBe(`${second} ${third}`);
    expect(tokensForIncoming([], [doc(), image()])).toBe(`${file} ${first}`);
  });

  it("expands an old draft name while keeping literal code and the delivery reference", () => {
    const files = [doc("draft-context.txt")];
    const current = `[File${NBSP}1${NBSP}·${NBSP}draft-context.txt${NBSP}·${NBSP}1${NBSP}B]`;
    const old = "Write [file1] and `[file1]`.";
    expect(expandAttachmentDraftTokens(old, files)).toBe(`Write ${current} and \`[file1]\`.`);
    expect(compactAttachmentDraftTokens(`Write ${current} and \`[file1]\`.`, files)).toBe(
      `Write ${tok("File", 1)} and \`[file1]\`.`,
    );
    expect(attachmentsDroppedByEdit(old, `Write ${current}`, files)).toEqual([]);
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
    "> ```\n> [image1]\n> [image2]\n> ```",
    "- ```\n  [image1]\n  [image2]\n  ```",
    "\t[image1]\n\t[image2]",
  ])("preserves literal Markdown code through token operations: %s", (code) => {
    const text = `${code}\n\n[image2]`;
    expect(findTokens(text, files).map((match) => match.start)).toEqual([
      text.lastIndexOf("[image2]"),
    ]);
    expect(removeAttachmentFromText(text, files, 0)).toBe(`${code}\n\n${tok("Image", 1)}`);
    expect(stripAttachmentTokens(text, files)).toBe(`${code}\n\n`);
    expect(
      deleteTokenAtCaret(text, code.indexOf("[image1]") + "[image1]".length, "back", files),
    ).toBeNull();
  });

  it("matches the exact token only", () => {
    expect(findTokens("[Image1] [image0] [image01] [image 1] [img1]", files)).toEqual([]);
    expect(findTokens("[image1]", [])).toEqual([]);
  });
  it("does not hide tokens after unmatched inline delimiters or escaped backticks", () => {
    expect(findTokens("` unmatched [image1]", files)).toHaveLength(1);
    expect(findTokens("\\`[image1]", files)).toHaveLength(1);
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
      `a b c ${tok("File", 1)}`,
    );
    expect(removeAttachmentFromText("[image1] fix", files, 0)).toBe("fix");
    expect(removeAttachmentFromText("fix [image1]", files, 0)).toBe("fix");
    expect(removeAttachmentFromText("fix [image1].", files, 0)).toBe("fix.");
    expect(removeAttachmentFromText("a [image1]\nb", files, 0)).toBe("a\nb");
  });

  it("renumbers the attachments left behind", () => {
    const files = [image(), image(), image()];
    const text = "[image1] and [image2] and [image3]";
    expect(removeAttachmentFromText(text, files, 0)).toBe(
      `and ${tok("Image", 1)} and ${tok("Image", 2)}`,
    );
    expect(removeAttachmentFromText(text, files, 1)).toBe(
      `${tok("Image", 1)} and and ${tok("Image", 2)}`,
    );
  });

  it("renumbers in one pass, so a renamed token is never renamed again", () => {
    const files = [image(), image(), image()];
    expect(removeAttachmentFromText("[image3] [image2] [image1]", files, 0)).toBe(
      `${tok("Image", 2)} ${tok("Image", 1)}`,
    );
  });

  it("handles [image1] [image2] [image10] and keeps kinds apart", () => {
    const files = [...Array.from({ length: 10 }, (_, i) => image(`${i}.png`)), doc()];
    const text = "[image1] [image2] [image10] [file1]";
    expect(removeAttachmentFromText(text, files, 0)).toBe(
      `${tok("Image", 1)} ${tok("Image", 9)} ${tok("File", 1)}`,
    );
    expect(removeAttachmentFromText(text, files, 9)).toBe(
      `${tok("Image", 1)} ${tok("Image", 2)} ${tok("File", 1)}`,
    );
    // Removing a file never touches the image numbering, and vice versa.
    expect(removeAttachmentFromText(text, files, 10)).toBe(
      `${tok("Image", 1)} ${tok("Image", 2)} ${tok("Image", 10)}`,
    );
    const mixed = [image(), doc("a"), doc("b")];
    expect(removeAttachmentFromText("[file1] [file2]", mixed, 1)).toBe(tok("File", 1));
    expect(removeAttachmentFromText("[file1] [file2]", mixed, 2)).toBe(tok("File", 1));
    expect(removeAttachmentFromText("[file1] [file2]", mixed, 0)).toBe(
      `${tok("File", 1)} ${tok("File", 2)}`,
    );
  });

  it("leaves tokens for attachments that do not exist, and code, as written", () => {
    const files = [image(), image()];
    expect(removeAttachmentFromText("[image1] [image7] `[image2]` arr[image2]", files, 0)).toBe(
      "[image7] `[image2]` arr[image2]",
    );
  });

  it("still finds the legacy form and rewrites surviving legacy tokens into the new form", () => {
    const files = [image(), image(), doc()];
    expect(findTokens("see [image1]", files).map((m) => [m.token, m.index])).toEqual([
      ["[image1]", 0],
    ]);
    expect(removeAttachmentFromText("[image1] [image2] [file1]", files, 0)).toBe(
      `${tok("Image", 1)} ${tok("File", 1)}`,
    );
    expect(removeAttachmentFromText("[image1] [image2] [file1]", files, 2)).toBe(
      `${tok("Image", 1)} ${tok("Image", 2)}`,
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
      `Attachments: ${tok("Image", 1)} = screenshot.png (1st attached image), ${tok("File", 1)} = src/app/App.tsx, ${tok("Image", 2)} = two.png (2nd attached image)`,
    );
  });

  it("falls back to the name when a file has no path, and keeps it on one line", () => {
    expect(attachmentLegend([make("audio", "voice\nnote.wav")])).toBe(
      `Attachments: ${tok("File", 1)} = voice note.wav`,
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
