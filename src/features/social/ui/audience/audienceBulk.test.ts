import { describe, expect, it, vi } from "vitest";
import { addTag, addToSequence, runPerPerson, suppressPeople } from "./audienceBulk";
import { asClient, clientMock } from "./audienceTestKit";

describe("runPerPerson", () => {
  it("keeps going after a failure and reports the failed person with the Host reason", async () => {
    const run = vi.fn(async (personId: string) => {
      if (personId === "p2") throw new Error("Rate limit reached.");
    });
    const result = await runPerPerson(["p1", "p2", "p3"], run);
    expect(run).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      done: 2,
      failed: [{ personId: "p2", reason: "Rate limit reached." }],
    });
  });
});

describe("addTag", () => {
  it("adds the tag to each person without dropping the tags they already have", async () => {
    const client = clientMock();
    const result = await addTag(
      asClient(client),
      [
        { id: "p1", tags: ["vip"] },
        { id: "p2", tags: [] },
      ],
      "lead",
    );
    expect(result.done).toBe(2);
    expect(client.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { tags: ["vip", "lead"] },
    });
    expect(client.people.update).toHaveBeenCalledWith({
      personId: "p2",
      patch: { tags: ["lead"] },
    });
  });
});

describe("addToSequence", () => {
  it("adds the people to the sequence's own list, since a sequence runs over its list", async () => {
    const client = clientMock();
    await addToSequence(asClient(client), { listId: "list-9" }, ["p1"]);
    expect(client.lists.addMembers).toHaveBeenCalledWith({ listId: "list-9", personIds: ["p1"] });
  });
});

describe("suppressPeople", () => {
  it("records a manual opt-out on every channel for each person", async () => {
    const client = clientMock();
    const result = await suppressPeople(asClient(client), ["p1"]);
    expect(result.done).toBe(1);
    expect(client.suppressions.add).toHaveBeenCalledWith({
      personId: "p1",
      channel: "all",
      reason: "manual",
    });
  });
});
