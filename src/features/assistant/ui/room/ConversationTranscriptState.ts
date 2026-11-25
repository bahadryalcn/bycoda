export type ConversationTranscriptState =
  | "loading"
  | "messages"
  | "filtered"
  | "search-failed"
  | "empty"
  | "closed";

/**
 * What the transcript area shows. "No messages yet" appears only after the selected thread's first
 * page finished loading with nothing in it; until then the area keeps its final layout with
 * skeleton bubbles.
 */
export function conversationTranscriptState(input: {
  threadId: string;
  query: string;
  searching: boolean;
  searchFailed?: boolean;
  loaded: boolean;
  visibleCount: number;
}): ConversationTranscriptState {
  if (input.query.trim()) {
    if (input.searching) return "loading";
    if (input.searchFailed) return "search-failed";
    return input.visibleCount ? "messages" : "filtered";
  }
  if (!input.threadId) return "closed";
  if (input.visibleCount) return "messages";
  return input.loaded ? "empty" : "loading";
}
