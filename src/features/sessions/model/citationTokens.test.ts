import { describe, expect, it } from "vitest";
import { findCitationTokens, removeCitationFromText, splitCitationTokens } from "./citationTokens";
import { deleteTokenAtCaret, findTokens } from "./attachmentTokens";
import { chatCitationToken } from "./chatCitation";

describe("citation tokens", () => {
  it("finds only tokens for existing citations, outside code and words", () => {
    const text = "see [quote1] and [quote3], `[quote2]`, arr[quote1] then [quote2]";
    expect(findCitationTokens(text, 2).map((match) => match.token)).toEqual([
      "[quote1]",
      "[quote2]",
    ]);
    expect(findCitationTokens(text, 0)).toEqual([]);
  });

  it("splits text around quote tokens", () => {
    expect(splitCitationTokens("a [quote1] b", 1)).toEqual([
      { text: "a " },
      { token: "[quote1]", index: 0 },
      { text: " b" },
    ]);
  });

  it("removes a citation token and renumbers the rest", () => {
    expect(removeCitationFromText("x [quote1] y [quote2] z [quote3]", 3, 0)).toBe(
      "x y [quote1] z [quote2]",
    );
    expect(removeCitationFromText("x [quote1]", 1, 5)).toBe("x [quote1]");
  });

  it("does not treat quote tokens as attachment tokens", () => {
    expect(findTokens("[quote1] [image1]", [{ kind: "image" }]).map((m) => m.token)).toEqual([
      "[image1]",
    ]);
  });

  it("deletes a whole quote token with backspace when passed as an extra token", () => {
    expect(deleteTokenAtCaret("hi [quote1] there", 11, "back", [], [chatCitationToken(0)])).toEqual(
      {
        text: "hi there",
        caret: 3,
      },
    );
  });
});
