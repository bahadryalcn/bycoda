import { describe, expect, it } from "vitest";
import { parseStandaloneHttpUrl, parseUserMessageLink, userLinkRanges } from "./linkPreview";

describe("parseStandaloneHttpUrl", () => {
  it("normalizes a standalone web URL for display", () => {
    expect(parseStandaloneHttpUrl("  https://www.example.com/docs/start?q=one#intro  ")).toEqual({
      url: "https://www.example.com/docs/start?q=one#intro",
      host: "example.com",
      displayUrl: "example.com/docs/start?q=one#intro",
    });
  });

  it("keeps a root URL compact", () => {
    expect(parseStandaloneHttpUrl("http://example.com/")?.displayUrl).toBe("example.com");
  });

  it("does not turn prose or credentialed URLs into preview cards", () => {
    expect(parseStandaloneHttpUrl("take a look at https://example.com")).toBeNull();
    expect(parseStandaloneHttpUrl("https://person:secret@example.com")).toBeNull();
    expect(parseStandaloneHttpUrl("file:///tmp/example.html")).toBeNull();
  });
});

describe("parseUserMessageLink", () => {
  it("extracts a URL followed by a comment", () => {
    expect(
      parseUserMessageLink("https://github.com/bahadryalcn/bycoda/pull/226 check this"),
    ).toEqual({
      link: {
        url: "https://github.com/bahadryalcn/bycoda/pull/226",
        host: "github.com",
        displayUrl: "github.com/bahadryalcn/bycoda/pull/226",
        githubWorkItem: {
          kind: "pr",
          repo: "bahadryalcn/bycoda",
          number: 226,
        },
      },
      beforeText: "",
      afterText: " check this",
    });
  });

  it("recognizes GitHub issues and links to a PR subpage", () => {
    expect(
      parseUserMessageLink("https://github.com/acme/widgets/issues/42#issuecomment-1")?.link
        .githubWorkItem,
    ).toEqual({ kind: "issue", repo: "acme/widgets", number: 42 });
    expect(
      parseUserMessageLink("https://www.github.com/acme/widgets/pull/73/files")?.link
        .githubWorkItem,
    ).toEqual({ kind: "pr", repo: "acme/widgets", number: 73 });
  });

  it("leaves other GitHub URLs as normal web links", () => {
    expect(
      parseUserMessageLink("https://github.com/acme/widgets/actions")?.link.githubWorkItem,
    ).toBeUndefined();
    expect(
      parseUserMessageLink("https://github.com/acme/widgets/issues/0")?.link.githubWorkItem,
    ).toBeUndefined();
  });

  it("preserves prose around a URL and drops sentence punctuation", () => {
    const result = parseUserMessageLink("Please review (https://example.com/docs), thanks");
    expect(result?.beforeText).toBe("Please review (");
    expect(result?.afterText).toBe("), thanks");
    expect(result?.link.url).toBe("https://example.com/docs");
  });

  it("returns null when there is no valid web URL", () => {
    expect(parseUserMessageLink("Nothing to preview here")).toBeNull();
  });
});

describe("userLinkRanges", () => {
  it("finds every web URL with its source range, without trailing punctuation", () => {
    const text = "https://github.com/acme/app/pull/1267 bunu incele, sonra https://example.com.";
    const ranges = userLinkRanges(text);
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual([
      "https://github.com/acme/app/pull/1267",
      "https://example.com",
    ]);
    expect(ranges[0].link.githubWorkItem).toEqual({
      kind: "pr",
      repo: "acme/app",
      number: 1267,
    });
  });

  it("ignores text without a web URL", () => {
    expect(userLinkRanges("file:///tmp/a.txt and plain words")).toEqual([]);
  });
});
