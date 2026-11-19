import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import {
  bulkDeleteNotice,
  bulkDeleteNoticeText,
  deleteSessionsInBulk,
  splitRunningSessions,
} from "./bulkSessionDelete";

afterEach(async () => {
  await setLanguagePreference("en");
});

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

  it("runs up to the concurrency limit at once and still records every outcome", async () => {
    let active = 0;
    let peak = 0;
    const result = await deleteSessionsInBulk(["a", "b", "c", "d", "e"], {
      isRunning: (id) => id === "c",
      concurrency: 2,
      deleteOne: async (id) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        if (id === "e") throw new Error("disk full");
      },
    });
    expect(peak).toBe(2);
    expect([...result.deleted].sort()).toEqual(["a", "b", "d"]);
    expect(result.skipped).toEqual(["c"]);
    expect(result.failed).toEqual([{ sessionId: "e", error: "disk full" }]);
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
    expect(bulkDeleteNoticeText(bulkDeleteNotice(result))).toBe(
      "1 conversation deleted. 1 running conversation was skipped. 1 conversation could not be deleted: disk full.",
    );
    expect(
      bulkDeleteNoticeText(bulkDeleteNotice({ deleted: ["a", "b"], skipped: [], failed: [] })),
    ).toBe("2 conversations deleted.");
  });

  it("keeps the counts and the first error of what was left behind", () => {
    expect(
      bulkDeleteNoticeText(bulkDeleteNotice({ deleted: [], skipped: [], failed: [] })),
    ).toBeNull();
    expect(
      bulkDeleteNoticeText(bulkDeleteNotice({ deleted: [], skipped: ["a", "b"], failed: [] })),
    ).toBe("2 running conversations were skipped.");
    expect(
      bulkDeleteNoticeText(
        bulkDeleteNotice({
          deleted: [],
          skipped: ["a"],
          failed: [{ sessionId: "b" }, { sessionId: "c", error: "disk full" }],
        }),
      ),
    ).toBe("1 running conversation was skipped. 2 conversations could not be deleted: disk full.");
  });

  it("uses the singular and the no-detail wording for a single failure", () => {
    expect(
      bulkDeleteNoticeText(
        bulkDeleteNotice({ deleted: [], skipped: [], failed: [{ sessionId: "b" }] }),
      ),
    ).toBe("1 conversation could not be deleted.");
    expect(
      bulkDeleteNoticeText(
        bulkDeleteNotice({
          deleted: [],
          skipped: [],
          failed: [{ sessionId: "b" }, { sessionId: "c" }],
        }),
      ),
    ).toBe("2 conversations could not be deleted.");
  });

  it("translates the result through the catalog and keeps the raw error verbatim", async () => {
    await setLanguagePreference("tr");
    const notice = bulkDeleteNotice({
      deleted: ["a", "b"],
      skipped: ["c"],
      failed: [{ sessionId: "d", error: "disk full" }],
    });
    expect(bulkDeleteNoticeText(notice)).toBe(
      "2 oturum silindi. Çalışan 1 oturum atlandı. 1 oturum silinemedi: disk full.",
    );
  });
});
