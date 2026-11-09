import { expect, it } from "vitest";
import { conversationTranscriptState } from "./ConversationTranscriptState";

const base = { threadId: "t", query: "", searching: false, loaded: false, visibleCount: 0 };

it("keeps the skeleton until the first page has loaded", () => {
  expect(conversationTranscriptState(base)).toBe("loading");
});
it("shows the empty state only after a completed load with zero messages", () => {
  expect(conversationTranscriptState({ ...base, loaded: true })).toBe("empty");
});
it("shows messages as soon as any are visible", () => {
  expect(conversationTranscriptState({ ...base, visibleCount: 2 })).toBe("messages");
});
it("covers search loading, no results and no open thread", () => {
  expect(conversationTranscriptState({ ...base, query: "x", searching: true })).toBe("loading");
  expect(conversationTranscriptState({ ...base, query: "x" })).toBe("filtered");
  expect(conversationTranscriptState({ ...base, query: "x", visibleCount: 1 })).toBe("messages");
  expect(conversationTranscriptState({ ...base, threadId: "" })).toBe("closed");
});
