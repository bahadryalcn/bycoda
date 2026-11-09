import { describe, expect, it } from "vitest";
import {
  chatCitationPreview,
  extractChatCitations,
  projectChatCitationsForProvider,
  serializeChatCitation,
  withChatCitations,
  type ChatCitation,
} from "./chatCitation";
import { consumeQuoteRequest } from "./quoteDraft";
import { skillInvocationTokens } from "../../skills/model/skillTokens";

const citation: ChatCitation = {
  version: 1,
  id: "citation-1",
  sessionId: "session-1",
  blockId: "block-2",
  text: "  Quoted @private/file $skill [text]\nİkinci satır.",
  sourceText: "Some preceding text.\n  Quoted @private/file $skill [text]\nİkinci satır.",
  occurrence: 0,
  comment: "Yorum [örnek] (yorum)",
};

describe("chat citations", () => {
  it("shows only the first six words without changing the saved citation", () => {
    const value = {
      ...citation,
      comment: "",
      text: " One\n two  three four five six seven eight ",
    };
    expect(chatCitationPreview(value)).toBe("One two three four five six…");
    expect(extractChatCitations(serializeChatCitation(value)).citations).toEqual([value]);
    expect(chatCitationPreview({ text: "quote", comment: " Short comment " })).toBe(
      "Short comment",
    );
  });

  it("bounds unbroken preview text without splitting emoji", () => {
    expect(chatCitationPreview({ text: "👩🏽‍💻".repeat(100), comment: "" })).toBe(
      "👩🏽‍💻".repeat(79) + "…",
    );
  });

  it("preserves bracket-heavy prose with and without a malformed citation marker", () => {
    const prose = "[".repeat(64_000);
    for (const text of [prose, `${prose}bycoda-citation:invalid`]) {
      expect(extractChatCitations(text)).toEqual({ text, citations: [] });
    }
  });

  it("bounds citation labels while preserving unsupported links as draft text", () => {
    const serialized = serializeChatCitation(citation);
    const payload = serialized.slice(serialized.indexOf("](bycoda-citation:"));
    expect(extractChatCitations(`[${"x".repeat(200)}${payload}`)).toEqual({
      text: "",
      citations: [citation],
    });
    const oversized = `[${"x".repeat(201)}${payload}`;
    expect(extractChatCitations(oversized)).toEqual({ text: oversized, citations: [] });
  });

  it("preserves leading command routing and exact trailing whitespace with durable references", () => {
    for (const prose of ["/plan Explain this", "/operator Check this\n\n", "\n\nMy draft\n", ""]) {
      const stored = withChatCitations(prose, [citation]);
      if (prose) expect(stored.startsWith(prose)).toBe(true);
      expect(extractChatCitations(stored)).toEqual({ text: prose, citations: [citation] });
    }
    expect(extractChatCitations(`${serializeChatCitation(citation)}\n\nOld draft`)).toEqual({
      text: "Old draft",
      citations: [citation],
    });
  });
  it("keeps quoted and commented skill tokens literal through final provider policy scans", () => {
    const quote = {
      ...citation,
      text: "````\nPlease run $disabled now\n````",
      comment: "Use $private next",
    };
    const projected = projectChatCitationsForProvider(
      withChatCitations("Use $requested now", [quote]),
    );
    expect(skillInvocationTokens(projected).map((token) => token.name)).toEqual(["requested"]);
    expect(projected).toContain("`````json");
  });
  it("round-trips exact quote, source, comment and whitespace without exposing metadata as editable text", () => {
    const text = "  My draft\n\n";
    const stored = withChatCitations(text, [citation]);
    expect(extractChatCitations(stored)).toEqual({ text, citations: [citation] });
    expect(extractChatCitations(serializeChatCitation(citation))).toEqual({
      text: "",
      citations: [citation],
    });
  });

  it("retains multiple sources and exact user text", () => {
    const second = { ...citation, id: "citation-2", comment: "" };
    expect(extractChatCitations(withChatCitations("\n\nDo this", [citation, second]))).toEqual({
      text: "\n\nDo this",
      citations: [citation, second],
    });
  });

  it("preserves corrupt and unsupported markers as ordinary text", () => {
    for (const value of [
      "[quote](bycoda-citation:%ZZ)",
      "[quote](bycoda-citation:%7B%22version%22%3A2%7D)",
    ])
      expect(extractChatCitations(value)).toEqual({ text: value, citations: [] });
  });

  it("does not wrap structured citation requests in a plain blockquote", () => {
    const result = consumeQuoteRequest("Keep my draft", null, {
      id: 2,
      text: serializeChatCitation(citation),
    });
    expect(extractChatCitations(result.draft)).toEqual({
      text: "Keep my draft [quote1] ",
      citations: [citation],
    });
    expect(result.caret).toBe("Keep my draft [quote1] ".length);
    expect(
      consumeQuoteRequest(result.draft, 2, { id: 2, text: serializeChatCitation(citation) })
        .changed,
    ).toBe(false);
  });

  it("places citation tokens at the caret so the quote can sit inside a sentence", () => {
    const second = { ...citation, id: "citation-2" };
    const first = consumeQuoteRequest(
      "Compare  with that",
      null,
      { id: 1, text: serializeChatCitation(citation) },
      { start: 8, end: 8 },
    );
    expect(extractChatCitations(first.draft).text).toBe("Compare [quote1] with that");
    expect(first.caret).toBe("Compare [quote1]".length);
    const next = consumeQuoteRequest(first.draft, 1, {
      id: 2,
      text: serializeChatCitation(second),
    });
    expect(extractChatCitations(next.draft)).toEqual({
      text: "Compare [quote1] with that [quote2] ",
      citations: [citation, second],
    });
  });

  it("tells providers which snapshot each inline quote token names", () => {
    const output = projectChatCitationsForProvider(withChatCitations("Fix [quote1]", [citation]));
    expect(output).toContain("Fix [quote1]");
    expect(output).toContain('"ref": "[quote1]"');
  });

  it("gives providers literal quoted text, comment and stable source identity", () => {
    const output = projectChatCitationsForProvider(withChatCitations("Improve this", [citation]));
    expect(output).toContain("Improve this");
    expect(output).toContain('"blockId": "block-2"');
    expect(output).toContain("Quoted @private/file $skill [text]");
    expect(output).toContain(citation.comment);
    expect(output).not.toContain("bycoda-citation:");
    expect(output).not.toContain(citation.sourceText);
  });
});
