import { describe, expect, it } from "vitest";
import { parseSyncRecord } from "./syncProtocol";

describe("parseSyncRecord", () => {
  it("accepts a well-formed record", () => {
    const record = parseSyncRecord({
      table: "group",
      id: "g1",
      rev: 3,
      value: { id: "g1", name: "Work", collapsed: false },
    });
    expect(record).toEqual({
      table: "group",
      id: "g1",
      rev: 3,
      value: { id: "g1", name: "Work", collapsed: false },
    });
  });

  it("accepts a tombstone (deleted record)", () => {
    expect(parseSyncRecord({ table: "group", id: "g1", rev: 4, value: null })).toEqual({
      table: "group",
      id: "g1",
      rev: 4,
      value: null,
    });
  });

  it("rejects an unknown table, a missing id, or a non-integer revision", () => {
    expect(parseSyncRecord({ table: "bogus", id: "x", rev: 1, value: null })).toBeNull();
    expect(parseSyncRecord({ table: "group", id: "", rev: 1, value: null })).toBeNull();
    expect(parseSyncRecord({ table: "group", id: "g1", rev: 1.5, value: null })).toBeNull();
    expect(parseSyncRecord(null)).toBeNull();
  });
});
