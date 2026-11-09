// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
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
