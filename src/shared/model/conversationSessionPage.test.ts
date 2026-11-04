import { expect, it } from "vitest";
import { conversationSessionPage } from "./conversationSessionPage";

it("bounds large lists before link lookup and continues without duplicate rows", () => {
  const rows = Array.from({ length: 265 }, (_, index) => ({
    id: `s${index}`,
    title: `Session ${index}`,
    busy: index % 2 === 0,
    lastActivityAt: index,
  }));
  const first = conversationSessionPage(rows, { state: "running", limit: 20 });
  const next = conversationSessionPage(rows, {
    state: "running",
    limit: 20,
    cursor: first.nextCursor,
  });
  expect(first.sessions).toHaveLength(20);
  expect(first.total).toBe(133);
  expect(next.sessions).toHaveLength(20);
  expect(
    next.sessions.every((row) => !first.sessions.some((previous) => previous.id === row.id)),
  ).toBe(true);
});
it("rejects stale cursors and invalid bounds rather than returning misleading empty data", () => {
  expect(() => conversationSessionPage([], { cursor: "gone" })).toThrow("restart");
  expect(() => conversationSessionPage([], { limit: 101 })).toThrow("100");
  expect(() => conversationSessionPage([], { state: "stalled" })).toThrow("state");
});
