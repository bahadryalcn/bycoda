import { describe, expect, it, vi } from "vitest";
import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { deleteNotesInOrder, restoreNotesInOrder } from "./noteBulkDelete";

const note = (id: string) => ({ id, title: `Note ${id}`, body: "", updatedAt: 1 }) as AssistantNote;

describe("deleteNotesInOrder", () => {
  it("collects receipts and notes deleted without one", async () => {
    const outcome = await deleteNotesInOrder([note("a"), note("b")], async ({ id }) =>
      id === "a" ? { ok: true, trashId: "notetrash:1" } : { ok: true },
    );
    expect(outcome).toEqual({ trashIds: ["notetrash:1"], withoutReceipt: ["Note b"], deleted: 2 });
  });

  it("stops at the first failure and leaves later notes untouched", async () => {
    const remove = vi.fn(async ({ id }: AssistantNote) => {
      if (id === "b") throw new Error("changed");
      return { ok: true, trashId: `notetrash:${id}` };
    });
    const outcome = await deleteNotesInOrder([note("a"), note("b"), note("c")], remove);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(outcome.deleted).toBe(1);
    expect(outcome.trashIds).toEqual(["notetrash:a"]);
    expect(outcome.error).toBeInstanceOf(Error);
  });

  it("treats an unconfirmed result as a failure", async () => {
    const outcome = await deleteNotesInOrder([note("a")], async () => ({ ok: false }));
    expect(outcome.deleted).toBe(0);
    expect(outcome.error).toBeInstanceOf(Error);
  });
});

describe("restoreNotesInOrder", () => {
  it("restores every id", async () => {
    expect(await restoreNotesInOrder(["x", "y"], async () => ({ ok: true }))).toEqual({
      remaining: [],
    });
  });

  it("keeps the unconfirmed id and the rest for a retry", async () => {
    const result = await restoreNotesInOrder(["x", "y", "z"], async (id) => ({ ok: id !== "y" }));
    expect(result).toEqual({ remaining: ["y", "z"] });
  });

  it("returns the original thrown error", async () => {
    const failure = new Error("Host said no");
    const result = await restoreNotesInOrder(["x", "y"], async (id) => {
      if (id === "x") throw failure;
      return { ok: true };
    });
    expect(result).toEqual({ remaining: ["x", "y"], error: failure });
  });
});
