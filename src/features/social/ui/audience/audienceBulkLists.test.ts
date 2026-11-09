import { describe, expect, it, vi } from "vitest";
import { addTag, addToList, removeFromList, runPerPerson, suppressPeople } from "./audienceBulk";
import { asClient, clientMock } from "./audienceTestKit";

describe("addToList and removeFromList", () => {
  it("send the whole selection in one call and return how many the Host changed", async () => {
    const client = clientMock({
      lists: {
        ...clientMock().lists,
        addMembers: vi.fn(async () => ({ changed: 2 })),
        removeMembers: vi.fn(async () => ({ changed: 1 })),
      },
    });
    expect(await addToList(asClient(client), "l1", ["p1", "p2", "p3"])).toBe(2);
    expect(client.lists.addMembers).toHaveBeenCalledWith({
      listId: "l1",
      personIds: ["p1", "p2", "p3"],
    });
    expect(await removeFromList(asClient(client), "l1", ["p1"])).toBe(1);
    expect(client.lists.removeMembers).toHaveBeenCalledWith({ listId: "l1", personIds: ["p1"] });
  });

  it("let a Host refusal reach the caller", async () => {
    const client = clientMock({
      lists: {
        ...clientMock().lists,
        addMembers: vi.fn(async () => {
          throw new Error("List is read only.");
        }),
      },
    });
    await expect(addToList(asClient(client), "l1", ["p1"])).rejects.toThrow("List is read only.");
  });
});

describe("runPerPerson", () => {
  it("runs one person after another, never in parallel", async () => {
    const order: string[] = [];
    let running = 0;
    let peak = 0;
    await runPerPerson(["p1", "p2", "p3"], async (personId) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push(personId);
      running -= 1;
    });
    expect(order).toEqual(["p1", "p2", "p3"]);
    expect(peak).toBe(1);
  });

  it("uses a generic reason when a failure carries no message", async () => {
    const result = await runPerPerson(["p1"], async () => {
      throw "plain text";
    });
    expect(result).toEqual({
      done: 0,
      failed: [{ personId: "p1", reason: "Something went wrong. Try again." }],
    });
  });

  it("does nothing for an empty selection", async () => {
    const run = vi.fn();
    expect(await runPerPerson([], run)).toEqual({ done: 0, failed: [] });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("addTag", () => {
  it("trims the tag, leaves a person who already has it unchanged and asks once per person", async () => {
    const client = clientMock();
    const result = await addTag(
      asClient(client),
      [
        { id: "p1", tags: ["vip"] },
        { id: "p1", tags: ["vip"] },
      ],
      "  vip ",
    );
    expect(result.done).toBe(1);
    expect(client.people.update).toHaveBeenCalledTimes(1);
    expect(client.people.update).toHaveBeenCalledWith({ personId: "p1", patch: { tags: ["vip"] } });
  });

  it("reports a refused update and still updates the others", async () => {
    const client = clientMock({
      people: {
        ...clientMock().people,
        update: vi.fn(async (input: { personId: string }) => {
          if (input.personId === "p1") throw new Error("Locked.");
          return {};
        }),
      },
    });
    const result = await addTag(
      asClient(client),
      [
        { id: "p1", tags: [] },
        { id: "p2", tags: [] },
      ],
      "lead",
    );
    expect(result).toEqual({ done: 1, failed: [{ personId: "p1", reason: "Locked." }] });
  });
});

describe("suppressPeople", () => {
  it("collects the people whose opt-out the Host refused", async () => {
    const client = clientMock({
      suppressions: {
        add: vi.fn(async (input: { personId?: string }) => {
          if (input.personId === "p2") throw new Error("Host refused.");
          return { id: "x" };
        }),
      },
    });
    const result = await suppressPeople(asClient(client), ["p1", "p2"]);
    expect(result).toEqual({ done: 1, failed: [{ personId: "p2", reason: "Host refused." }] });
  });
});
