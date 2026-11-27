// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCitation } from "./chatCitation";
import { chatCitationRange, highlightChatCitation } from "./chatCitationHighlight";

const citation: ChatCitation = {
  version: 1,
  id: "citation",
  sessionId: "session",
  blockId: "block",
  text: "same",
  sourceText: "same and same",
  occurrence: 1,
  comment: "Only the second",
};
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function source(session = "session", text = "same and <strong>same</strong>") {
  document.body.innerHTML = `<div data-chat-citation-session="${session}"><div data-selectable-agent-response="block">${text}</div></div>`;
}
describe("chat citation source identity", () => {
  it("reports a missing source after its bounded reveal attempt without discarding the quote", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div data-chat-citation-session="session"></div>';
    const unavailable = vi.fn();
    expect(highlightChatCitation(citation, { navigate: true, onUnavailable: unavailable })).toBe(
      true,
    );
    vi.advanceTimersByTime(2500);
    expect(unavailable).toHaveBeenCalledOnce();
    expect(citation.text).toBe("same");
  });
  it("resolves the selected occurrence across formatting without changing selection", () => {
    source();
    const range = chatCitationRange(citation, document);
    expect(range?.toString()).toBe("same");
    expect(range?.startContainer.parentElement?.tagName).toBe("STRONG");
    expect(document.getSelection()?.isCollapsed).toBe(true);
  });
  it("does not highlight an equal quote in another session", () => {
    source("other-session");
    expect(chatCitationRange(citation, document)).toBeNull();
    expect(highlightChatCitation(citation)).toBe(false);
  });
  it("rejects a changed source snapshot, missing occurrence and hidden session", () => {
    source("session", "changed same and same");
    expect(chatCitationRange(citation, document)).toBeNull();
    source();
    expect(chatCitationRange({ ...citation, occurrence: 2 }, document)).toBeNull();
    document.body.firstElementChild?.setAttribute("hidden", "");
    expect(chatCitationRange(citation, document)).toBeNull();
  });
  it("never navigates away when an already mounted source changed", () => {
    source("session", "different same and same");
    expect(highlightChatCitation(citation, { navigate: true })).toBe(false);
  });
});

const HIGHLIGHT_NAME = "bycoda-chat-citation";
class FakeHighlight {
  readonly range: Range;
  constructor(range: Range) {
    this.range = range;
  }
}
function mountSession(): HTMLElement {
  document.body.innerHTML = '<div data-chat-citation-session="session"></div>';
  return document.body.firstElementChild as HTMLElement;
}
function revealSource(root: HTMLElement, html = "same and <strong>same</strong>") {
  root.innerHTML = `<div data-selectable-agent-response="block">${html}</div>`;
}
describe("late-revealed chat citation highlight", () => {
  let highlights: Map<string, unknown>;
  beforeEach(() => {
    vi.useFakeTimers();
    highlights = new Map();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", FakeHighlight);
  });
  it("keeps a source revealed after the unavailable timeout highlighted for its full duration", async () => {
    const root = mountSession();
    const unavailable = vi.fn();
    expect(highlightChatCitation(citation, { navigate: true, onUnavailable: unavailable })).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(2000);
    revealSource(root);
    await vi.advanceTimersByTimeAsync(0);
    expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
    expect(unavailable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(299);
    expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
  });
  it("reports unavailable and clears when the source never appears", async () => {
    mountSession();
    const unavailable = vi.fn();
    expect(highlightChatCitation(citation, { navigate: true, onUnavailable: unavailable })).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(2500);
    expect(unavailable).toHaveBeenCalledOnce();
    expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
  });
  it("does not paint or report a late source whose snapshot changed", async () => {
    const root = mountSession();
    const unavailable = vi.fn();
    highlightChatCitation(citation, { navigate: true, onUnavailable: unavailable });
    await vi.advanceTimersByTimeAsync(2000);
    revealSource(root, "changed same and same");
    await vi.advanceTimersByTimeAsync(0);
    expect(highlights.size).toBe(0);
    expect(unavailable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(highlights.size).toBe(0);
    expect(unavailable).toHaveBeenCalledOnce();
  });
  it("cancels a superseded pending request so its late reveal neither paints nor reports", async () => {
    const root = mountSession();
    const stale = vi.fn();
    highlightChatCitation(citation, { navigate: true, onUnavailable: stale });
    await vi.advanceTimersByTimeAsync(1000);
    expect(highlightChatCitation(citation)).toBe(false);
    revealSource(root);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(highlights.size).toBe(0);
    expect(stale).not.toHaveBeenCalled();
  });
  it("lets a newer highlight outlive the superseded request's expiry timer", async () => {
    const root = mountSession();
    const stale = vi.fn();
    highlightChatCitation(citation, { navigate: true, onUnavailable: stale });
    await vi.advanceTimersByTimeAsync(1000);
    revealSource(root);
    expect(highlightChatCitation(citation)).toBe(true);
    await vi.advanceTimersByTimeAsync(1600);
    expect(highlights.has(HIGHLIGHT_NAME)).toBe(true);
    expect(stale).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(highlights.has(HIGHLIGHT_NAME)).toBe(false);
  });
});
