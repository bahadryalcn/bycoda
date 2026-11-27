import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { readAudienceWorkbook } from "./audience-sheet";

function workbook(rows: unknown[][], extraSheet = false): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "First");
  if (extraSheet) utils.book_append_sheet(book, utils.aoa_to_sheet([["second"]]), "Second");
  return new Uint8Array(write(book, { type: "buffer", bookType: "xlsx" }));
}

describe("readAudienceWorkbook", () => {
  it("returns the first sheet as text rows and skips blank rows", async () => {
    const rows = await readAudienceWorkbook(
      workbook([["platformId", "name"], [], ["u1", "Ada"], ["", ""], ["u2"]], true),
    );
    expect(rows).toEqual([["platformId", "name"], ["u1", "Ada"], ["u2"]]);
  });

  it("keeps an empty cell between filled ones as an empty string", async () => {
    const rows = await readAudienceWorkbook(workbook([["a", "", "c"]]));
    expect(rows).toEqual([["a", "", "c"]]);
  });

  it("reads off the event loop so timers keep firing during a large parse", async () => {
    const big = workbook(
      Array.from({ length: 5000 }, (_, index) => [`u${index}`, `Name ${index}`, "p1", "a;b;c"]),
    );
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
    }, 1);
    try {
      const rows = await readAudienceWorkbook(big);
      expect(rows).toHaveLength(5000);
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });

  it("runs queued parses one after another and refuses a flood", async () => {
    const small = workbook([["a"]]);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => readAudienceWorkbook(small)),
    );
    const refused = results.filter((result) => result.status === "rejected");
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(refused.length).toBeGreaterThan(0);
    expect(String((refused[0] as PromiseRejectedResult).reason)).toContain("Retry shortly");
    // The queue drains, so the next parse is admitted again.
    await expect(readAudienceWorkbook(small)).resolves.toEqual([["a"]]);
  });
});
