// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  ADD_TO_CHAT_EVENT,
  acknowledgeQuoteRequest,
  appendComposerInsert,
  appendSelectionQuote,
  requestAddToChat,
  type AddToChatRequest,
  composerSeedForAddToChat,
  consumeQuoteRequest,
  isMarkdownBlockquotePosition,
  type QuoteRequest,
} from "./quoteDraft";

describe("appendSelectionQuote", () => {
  it("formats a multiline selection and leaves room for a reply", () => {
    expect(appendSelectionQuote("", "line one\r\nline two")).toBe("> line one\n> line two\n\n");
  });

  it("keeps leading indentation and drops only surrounding blank lines", () => {
    expect(appendSelectionQuote("", "\n  \n    if ready:\n        run()\n\n")).toBe(
      ">     if ready:\n>         run()\n\n",
    );
  });

  it("preserves intentional blank lines inside a quote", () => {
    expect(appendSelectionQuote("", "one\n\ntwo")).toBe("> one\n>\n> two\n\n");
  });

  it.each([
    ["draft", "draft\n\n> quote\n\n"],
    ["draft\n", "draft\n\n> quote\n\n"],
    ["draft\n\n", "draft\n\n> quote\n\n"],
  ])("separates an existing draft %#", (draft, expected) => {
    expect(appendSelectionQuote(draft, "quote")).toBe(expected);
  });

  it("ignores whitespace-only selections", () => {
    expect(appendSelectionQuote("draft", "  \n ")).toBe("draft");
  });
});

describe("appendComposerInsert", () => {
  it("keeps the exact selected text and normalizes CRLF only", () => {
    expect(appendComposerInsert("", "  key:\r\n    child: 1\r\n")).toBe("  key:\n    child: 1\n\n");
  });

  it("ignores whitespace-only text", () => {
    expect(appendComposerInsert("draft", " \n\t ")).toBe("draft");
  });
});

describe("requestAddToChat", () => {
  it("dispatches the indented text unchanged and skips empty selections", () => {
    const events: AddToChatRequest[] = [];
    const onAdd = (event: Event) => events.push((event as CustomEvent<AddToChatRequest>).detail);
    window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
    try {
      requestAddToChat("   \n ");
      requestAddToChat("    indented\r\n  more\r\n", "plain");
    } finally {
      window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
    }
    expect(events).toEqual([{ text: "    indented\n  more", mode: "plain" }]);
  });
});

describe("composerSeedForAddToChat", () => {
  it("preserves the requested insertion mode for a new composer", () => {
    expect(composerSeedForAddToChat("selected")).toBe("> selected\n\n");
    expect(composerSeedForAddToChat("Comment", "plain")).toBe("Comment\n\n");
  });
});

describe("isMarkdownBlockquotePosition", () => {
  it("recognizes tokens after nested quote markers", () => {
    const text = "plain /one\n> /two\n  >> @file";
    expect(isMarkdownBlockquotePosition(text, text.indexOf("/one"))).toBe(false);
    expect(isMarkdownBlockquotePosition(text, text.indexOf("/two"))).toBe(true);
    expect(isMarkdownBlockquotePosition(text, text.indexOf("@file"))).toBe(true);
  });
});

describe("consumeQuoteRequest", () => {
  const request: QuoteRequest = { id: 1, text: "selected" };

  it("consumes a request once", () => {
    expect(consumeQuoteRequest("draft", null, request)).toEqual({
      draft: "draft\n\n> selected\n\n",
      consumedId: 1,
      changed: true,
    });
    expect(consumeQuoteRequest("draft", 1, request)).toEqual({
      draft: "draft",
      consumedId: 1,
      changed: false,
    });
  });

  it("accepts a new id even when the text is identical", () => {
    expect(consumeQuoteRequest("", 1, { id: 2, text: "selected" })).toMatchObject({
      consumedId: 2,
      changed: true,
    });
  });

  it("inserts plain text without quoting", () => {
    expect(
      consumeQuoteRequest("draft", null, {
        id: 3,
        text: "Note: Auth\n\nUse a cookie.",
        mode: "plain",
      }),
    ).toEqual({
      draft: "draft\n\nNote: Auth\n\nUse a cookie.\n\n",
      consumedId: 3,
      changed: true,
    });
  });
});

describe("acknowledgeQuoteRequest", () => {
  it("clears only the request that was acknowledged", () => {
    const current: QuoteRequest = { id: 2, text: "newer" };
    expect(acknowledgeQuoteRequest(current, 2)).toBeUndefined();
    expect(acknowledgeQuoteRequest(current, 1)).toBe(current);
  });
});
