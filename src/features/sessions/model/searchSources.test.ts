import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  collectSearchSources,
  linkSearchCitations,
  normalizeSearchSources,
  type SearchSource,
} from "./searchSources";
import { boundedToolPreview } from "./toolInspection";

const a: SearchSource = { title: "Alpha", url: "https://www.alpha.dev/a", domain: "alpha.dev" };
const b: SearchSource = { title: "Beta", url: "https://beta.io/b?x=1", domain: "beta.io" };

describe("normalizeSearchSources", () => {
  it("keeps http(s) rows, strips www, dedupes and falls back to the domain", () => {
    expect(
      normalizeSearchSources([
        { title: " Alpha ", url: "https://www.alpha.dev/a" },
        { title: "again", url: "https://www.alpha.dev/a" },
        { url: "https://beta.io/b?x=1" },
        { title: "bad", url: "javascript:alert(1)" },
        { title: "file", url: "file:///etc/passwd" },
        { title: "none" },
        "nope",
      ]),
    ).toEqual([a, { ...b, title: "beta.io" }]);
  });

  it("caps the count and rejects non-arrays", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ url: `https://s${i}.dev/` }));
    expect(normalizeSearchSources(many)).toHaveLength(20);
    expect(normalizeSearchSources({ url: "https://a.dev" })).toEqual([]);
  });

  it("is applied to saved history by boundedToolPreview", () => {
    const preview = boundedToolPreview({
      kind: "search",
      query: "q",
      sources: [{ title: "x", url: "ftp://x" }, a] as SearchSource[],
    });
    expect(preview?.sources).toEqual([a]);
    expect(
      boundedToolPreview({ kind: "search", sources: [{ url: "ftp://x" }] as SearchSource[] }),
    ).not.toHaveProperty("sources");
  });
});

describe("collectSearchSources", () => {
  it("joins every search in the turn, one entry per URL", () => {
    const block = (id: string, sources?: SearchSource[]): Block =>
      ({
        id,
        role: "tool",
        text: "",
        tool: {
          id,
          kind: "search",
          title: "q",
          status: "completed",
          preview: { kind: "search", sources },
        },
      }) as Block;
    expect(collectSearchSources([block("1", [a]), block("2"), block("3", [a, b])])).toEqual([a, b]);
  });
});

describe("linkSearchCitations", () => {
  it("links [n] to the nth source with title and domain on the link", () => {
    expect(linkSearchCitations("Fast [1] and slow [2][1].", [a, b])).toBe(
      'Fast [\\[1\\]](<https://www.alpha.dev/a> "Alpha · alpha.dev") and slow ' +
        '[\\[2\\]](<https://beta.io/b?x=1> "Beta · beta.io")' +
        '[\\[1\\]](<https://www.alpha.dev/a> "Alpha · alpha.dev").',
    );
  });

  it("leaves unknown numbers, links, references, code and words alone", () => {
    const text = [
      "[3] none",
      "[1](https://x.dev) link",
      "[1]: https://x.dev",
      "[label][1] ref",
      "arr[1] word",
      "`[1]` code",
      "```\n[1]\n```",
    ].join("\n");
    expect(linkSearchCitations(text, [a, b])).toBe(text);
  });

  it("does nothing without sources", () => {
    expect(linkSearchCitations("see [1]", [])).toBe("see [1]");
  });
});
