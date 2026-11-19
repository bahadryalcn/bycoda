import { describe, expect, it } from "vitest";
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
    expect(formatDiffComment(target, " Please handle a missing cookie. ")).toBe(
      [
        "Diff comment on `src/auth.ts:42`:",
        "",
        "> +const token = readCookie();",
        "",
        "Please handle a missing cookie.",
      ].join("\n"),
    );
  });

  it("uses the old line number and labels deleted lines", () => {
    expect(
      formatDiffComment(
        {
          path: "src/old.ts",
          line: {
            kind: "del",
            text: "legacy();",
            oldNumber: 8,
            newNumber: null,
          },
        },
        "Keep this behavior.",
      ),
    ).toContain("`src/old.ts:8` (deleted line)");
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
