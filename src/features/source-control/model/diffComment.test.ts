import { describe, expect, it } from "vitest";
import { extractChatCitations } from "../../sessions/model/chatCitation";
import {
  diffCommentLocation,
  formatDiffComment,
  readDiffCommentDraft,
  writeDiffCommentDraft,
} from "./diffComment";

describe("diff comment drafts", () => {
  const line = (kind: "add" | "del", number: number) => ({
    path: "src/a.ts",
    line: {
      kind,
      text: "x",
      oldNumber: kind === "del" ? number : null,
      newNumber: kind === "add" ? number : null,
    },
  });

  it("keeps a draft per line and kind, and clears it when emptied", () => {
    writeDiffCommentDraft(line("add", 5), "first");
    writeDiffCommentDraft(line("del", 5), "second");
    expect(readDiffCommentDraft(line("add", 5))).toBe("first");
    expect(readDiffCommentDraft(line("del", 5))).toBe("second");
    expect(readDiffCommentDraft(line("add", 6))).toBe("");
    expect(readDiffCommentDraft({ ...line("add", 5), path: "src/b.ts" })).toBe("");

    writeDiffCommentDraft(line("add", 5), "  ");
    writeDiffCommentDraft(line("del", 5), "");
    expect(readDiffCommentDraft(line("add", 5))).toBe("");
    expect(readDiffCommentDraft(line("del", 5))).toBe("");
  });
});

describe("diff comments", () => {
  it("formats a comment on a current line for the composer", () => {
    const target = {
      path: "src/auth.ts",
      line: {
        kind: "add" as const,
        text: "const token = readCookie();",
        oldNumber: null,
        newNumber: 42,
      },
    };

    expect(diffCommentLocation(target)).toBe("src/auth.ts:42");
    expect(
      extractChatCitations(formatDiffComment(target, " Please handle a missing cookie. ")),
    ).toMatchObject({
      text: "",
      citations: [
        {
          file: { path: "src/auth.ts", line: 42, kind: "add" },
          text: "const token = readCookie();",
          comment: "Please handle a missing cookie.",
        },
      ],
    });
  });

  it("keeps deleted line information and blank source text", () => {
    expect(
      extractChatCitations(
        formatDiffComment(
          {
            path: "src/old.ts",
            line: {
              kind: "del",
              text: "  ",
              oldNumber: 8,
              newNumber: null,
            },
          },
          "Keep this behavior.",
        ),
      ),
    ).toMatchObject({
      citations: [
        {
          file: { path: "src/old.ts", line: 8, kind: "del" },
          text: "  ",
          comment: "Keep this behavior.",
        },
      ],
    });
  });

  it("ignores an empty comment", () => {
    expect(
      formatDiffComment(
        {
          path: "README.md",
          line: {
            kind: "context",
            text: "Title",
            oldNumber: 1,
            newNumber: 1,
          },
        },
        " \n ",
      ),
    ).toBe("");
  });
});
