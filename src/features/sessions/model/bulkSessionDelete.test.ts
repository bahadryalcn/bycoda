import { describe, expect, it, vi } from "vitest";
import {
  bulkDeleteConfirmMessage,
  bulkDeleteOutcome,
  bulkDeleteSummary,
  deleteSessionsInBulk,
  splitRunningSessions,
} from "./bulkSessionDelete";

describe("bulk session delete", () => {
  it("separates running conversations and drops duplicates", () => {
    expect(splitRunningSessions(["a", "b", "a", "c"], new Set(["b"]))).toEqual({
      deletable: ["a", "c"],
      running: ["b"],
    });
  });

  it("keeps going after a failure and reports each outcome", async () => {
    const deleteOne = vi.fn(async (id: string) => {
      if (id === "b") throw new Error("disk full");
      if (id === "c") return false;
      if (id === "e") throw new Error("Stop this session before deleting it");
      return true;
    });
    const result = await deleteSessionsInBulk(["a", "b", "c", "d", "e", "f"], {
      isRunning: (id) => id === "d",
      deleteOne,
    });

    expect(result).toEqual({
      deleted: ["a", "f"],
      skipped: ["d", "e"],
      failed: [{ sessionId: "b", error: "disk full" }, { sessionId: "c" }],
    });
    expect(deleteOne).not.toHaveBeenCalledWith("d");
  });

  it("deletes sequentially", async () => {
    const order: string[] = [];
    await deleteSessionsInBulk(["a", "b"], {
      isRunning: () => false,
      deleteOne: async (id) => {
        order.push(`start ${id}`);
        await Promise.resolve();
        order.push(`end ${id}`);
      },
    });
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("reports progress after each resolved result and names successful deletions", async () => {
    const progress = vi.fn();
    const result = await deleteSessionsInBulk(["a", "b", "c"], {
      isRunning: (id) => id === "b",
      deleteOne: async (id) => {
        if (id === "c") throw new Error("disk full");
      },
      onProgress: progress,
    });
    expect(progress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(bulkDeleteOutcome(result)).toBe(
      "1 conversation deleted. 1 running conversation was skipped. 1 conversation could not be deleted: disk full.",
    );
    expect(bulkDeleteOutcome({ deleted: ["a", "b"], skipped: [], failed: [] })).toBe(
      "2 conversations deleted.",
    );
  });

  it("words the confirmation for the count and the skipped ones", () => {
    expect(bulkDeleteConfirmMessage(1, 0)).toBe("Delete this conversation? This can’t be undone.");
    expect(bulkDeleteConfirmMessage(3, 2)).toBe(
      "Delete 3 conversations? This can’t be undone.\n\n2 running conversations will be skipped.",
    );
  });

  it("summarizes only what was left behind", () => {
    expect(bulkDeleteSummary({ skipped: [], failed: [] })).toBeNull();
    expect(bulkDeleteSummary({ skipped: ["a", "b"], failed: [] })).toBe(
      "2 running conversations were skipped.",
    );
    expect(
      bulkDeleteSummary({
        skipped: ["a"],
        failed: [{ sessionId: "b" }, { sessionId: "c", error: "disk full" }],
      }),
    ).toBe("1 running conversation was skipped. 2 conversations could not be deleted: disk full.");
  });
});
