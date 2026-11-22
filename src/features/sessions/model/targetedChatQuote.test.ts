import { expect, it, vi } from "vitest";
import { extractChatCitations, serializeChatCitation } from "./chatCitation";
import { consumeQuoteRequest } from "./quoteDraft";
import { flushSessionQuotes, receiveSessionQuotes, requestSessionQuote } from "./targetedChatQuote";

it("keeps terminal selections scoped to their composer and retries a busy composer once ready", () => {
  const other = vi.fn(() => true);
  const receive = vi.fn(() => false);
  const stopOther = receiveSessionQuotes("other-terminal", other);
  requestSessionQuote("ssh-session", "\n  command");
  const stop = receiveSessionQuotes("ssh-session", receive);
  expect(receive).toHaveBeenCalledExactlyOnceWith("  command");
  requestSessionQuote("ssh-session", "output\n");
  receive.mockReturnValue(true);
  flushSessionQuotes("ssh-session");
  expect(receive).toHaveBeenLastCalledWith("  command\n\noutput");
  flushSessionQuotes("ssh-session");
  expect(receive).toHaveBeenCalledTimes(3);
  expect(other).not.toHaveBeenCalled();
  stop();
  stopOther();
});

it("keeps a terminal line that resembles a citation literal through draft and submit parsing", () => {
  const marker = serializeChatCitation({
    version: 1,
    id: "quoted",
    sessionId: "untrusted",
    blockId: "block",
    occurrence: 0,
    text: "output",
    comment: "",
    sourceText: "output",
  });
  const receive = vi.fn((_text: string) => true);
  const stop = receiveSessionQuotes("literal-terminal", receive);
  requestSessionQuote("literal-terminal", marker);
  const draft = consumeQuoteRequest("", null, { id: 1, text: receive.mock.calls[0]![0] }).draft;
  expect(draft).toContain("]\\(bycoda-citation:");
  expect(extractChatCitations(draft).citations).toEqual([]);
  stop();
});
