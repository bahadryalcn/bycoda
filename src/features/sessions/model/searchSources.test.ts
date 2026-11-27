import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  collectSearchSources,
  isWebSearchBlock,
  isWebSearchName,
  linkSearchCitations,
  normalizeSearchSources,
  searchSourcesFromText,
  type SearchSource,
} from "./searchSources";
import { previewFromTool } from "../../../integrations/harness/providers/claude/claudeProtocol";
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

describe("searchSourcesFromText", () => {
  const result = [
    'Web search results for query: "release notes"',
    "",
    'Links: [{"title":"Alpha [beta] \\"notes\\"","url":"https://www.alpha.dev/a"},{"title":"Beta","url":"https://beta.io/b?x=1"}]',
    "",
    'Links: [{"title":"Again","url":"https://www.alpha.dev/a"},{"title":"Bad","url":"javascript:alert(1)"}]',
    "Summary text that mentions Links: [not json",
  ].join("\n");

  it("reads every Links array of a Claude Code WebSearch result, validated and deduped", () => {
    expect(searchSourcesFromText(result)).toEqual([{ ...a, title: 'Alpha [beta] "notes"' }, b]);
  });

  it("returns nothing for text without a list", () => {
    expect(searchSourcesFromText(undefined)).toEqual([]);
    expect(searchSourcesFromText("No results found.")).toEqual([]);
    expect(searchSourcesFromText("Links: [{broken")).toEqual([]);
  });

  it("carries the pages into a WebSearch preview but not into a file search", () => {
    expect(previewFromTool("WebSearch", { query: "release notes" }, result)).toMatchObject({
      kind: "search",
      query: "release notes",
      sources: [{ domain: "alpha.dev" }, { domain: "beta.io" }],
    });
    expect(previewFromTool("Grep", { pattern: "Links" }, result)?.sources).toBeUndefined();
  });
});

describe("isWebSearchBlock", () => {
  const block = (preview: NonNullable<Block["tool"]>["preview"]): Block => ({
    id: "s",
    role: "tool",
    text: "Find",
    tool: { kind: "search", title: "Find", status: "completed", preview },
  });

  it("knows a web search by its pages or by the tool that ran it", () => {
    expect(isWebSearchName("WebSearch")).toBe(true);
    expect(isWebSearchName("web_search")).toBe(true);
    expect(isWebSearchName("webSearch")).toBe(true);
    expect(isWebSearchName("Grep")).toBe(false);
    expect(isWebSearchBlock(block({ kind: "search", query: "x", sources: [a] }))).toBe(true);
    expect(isWebSearchBlock(block({ kind: "search", title: "webSearch", query: "x" }))).toBe(true);
    expect(isWebSearchBlock(block({ kind: "search", title: "Grep", query: "x" }))).toBe(false);
    expect(isWebSearchBlock(block({ kind: "read", path: "a.ts" }))).toBe(false);
  });
});
