import { describe, expect, it } from "vitest";
import {
  alignRequirementRowKeys,
  appendRequirementRowKey,
  EMPTY_REQUIREMENT_ROW_KEYS,
  removeRequirementRowKey,
} from "./taskRequirementRows";

describe("requirement row keys", () => {
  it("gives a removed middle row's neighbours their original keys", () => {
    let rows = EMPTY_REQUIREMENT_ROW_KEYS;
    for (let at = 0; at < 3; at += 1) rows = appendRequirementRowKey(rows, at);
    expect(rows.keys).toEqual([0, 1, 2]);

    const afterRemoval = removeRequirementRowKey(rows, 3, 1);
    expect(afterRemoval.keys).toEqual([0, 2]);
  });

  it("never reuses a key after a removal followed by an append", () => {
    let rows = appendRequirementRowKey(EMPTY_REQUIREMENT_ROW_KEYS, 0);
    rows = appendRequirementRowKey(rows, 1);
    rows = removeRequirementRowKey(rows, 2, 0);
    rows = appendRequirementRowKey(rows, 1);
    expect(new Set(rows.keys).size).toBe(rows.keys.length);
    expect(rows.keys).toEqual([1, 2]);
  });

  it("keeps keys by position when the draft is replaced outside the list", () => {
    const rows = { next: 4, keys: [0, 1] };
    const grown = alignRequirementRowKeys(rows, 3);
    expect(grown.keys).toEqual([0, 1, 4]);
    expect(grown.next).toBe(5);

    const shrunk = alignRequirementRowKeys(rows, 1);
    expect(shrunk.keys).toEqual([0]);
  });

  it("returns the same state when the length already matches", () => {
    const rows = { next: 2, keys: [0, 1] };
    expect(alignRequirementRowKeys(rows, 2)).toBe(rows);
  });
});
