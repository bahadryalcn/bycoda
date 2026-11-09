import { describe, expect, it } from "vitest";
import { splitMessageText } from "./messageText";

describe("splitMessageText", () => {
  it("returns plain text untouched", () => {
    expect(splitMessageText("Hi there\nsecond line")).toEqual([
      { kind: "text", text: "Hi there\nsecond line" },
    ]);
    expect(splitMessageText("")).toEqual([]);
  });

  it("links http(s) URLs and leaves trailing punctuation as text", () => {
    expect(splitMessageText("See https://example.com/a?b=1. Thanks")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "https://example.com/a?b=1", url: "https://example.com/a?b=1" },
      { kind: "text", text: ". Thanks" },
    ]);
  });

  it("keeps balanced parentheses and drops an unbalanced closing one", () => {
    const wiki = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(splitMessageText(`(${wiki})`)).toEqual([
      { kind: "text", text: "(" },
      { kind: "link", text: wiki, url: wiki },
      { kind: "text", text: ")" },
    ]);
  });

  it("does not link other schemes or markup", () => {
    expect(splitMessageText("javascript:alert(1) <a href=x>y</a> file:///etc")).toEqual([
      { kind: "text", text: "javascript:alert(1) <a href=x>y</a> file:///etc" },
    ]);
  });
});
