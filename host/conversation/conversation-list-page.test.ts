import { expect, it } from "vitest";
import { conversationListArguments, pageConversationListResult } from "./conversation-list-page";
it("preserves legacy owner arguments while bounding array and multi-collection output", () => {
  const rows = Array.from({ length: 201 }, (_, id) => ({ id }));
  expect(
    conversationListArguments("devices.list", { machineId: "m", offset: 20, limit: 5 }),
  ).toEqual({ machineId: "m" });
  expect(pageConversationListResult("tasks.list", { offset: 20, limit: 5 }, rows)).toEqual({
    items: rows.slice(20, 25),
    total: 201,
    nextOffset: 25,
  });
  expect(
    pageConversationListResult(
      "crews.list",
      { limit: 5 },
      { definitions: rows, agents: rows.slice(0, 2) },
    ),
  ).toMatchObject({
    definitions: rows.slice(0, 5),
    agents: rows.slice(0, 2),
    pagination: {
      definitions: { total: 201, nextOffset: 5 },
      agents: { total: 2, nextOffset: null },
    },
  });
});
