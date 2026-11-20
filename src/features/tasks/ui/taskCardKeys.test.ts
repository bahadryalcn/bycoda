import { describe, expect, it } from "vitest";
import { taskCardKeyIntent } from "./taskCardKeys";

const base = {
  key: "",
  altKey: false,
  ownTarget: true,
  canMoveEarlier: true,
  canMoveLater: true,
  busy: false,
};

describe("taskCardKeyIntent", () => {
  it("opens the card on Enter and Space", () => {
    expect(taskCardKeyIntent({ ...base, key: "Enter" })).toBe("open");
    expect(taskCardKeyIntent({ ...base, key: " " })).toBe("open");
  });

  it("ignores keys pressed inside a nested control", () => {
    expect(taskCardKeyIntent({ ...base, key: "Enter", ownTarget: false })).toBeNull();
    expect(taskCardKeyIntent({ ...base, key: " ", ownTarget: false })).toBeNull();
    expect(
      taskCardKeyIntent({ ...base, key: "ArrowUp", altKey: true, ownTarget: false }),
    ).toBeNull();
  });

  it("moves the card with Alt+Up and Alt+Down through the existing actions", () => {
    expect(taskCardKeyIntent({ ...base, key: "ArrowUp", altKey: true })).toBe("earlier");
    expect(taskCardKeyIntent({ ...base, key: "ArrowDown", altKey: true })).toBe("later");
  });

  it("needs Alt for a move, so plain arrows keep their default", () => {
    expect(taskCardKeyIntent({ ...base, key: "ArrowUp" })).toBeNull();
    expect(taskCardKeyIntent({ ...base, key: "ArrowDown" })).toBeNull();
  });

  it("does not move past the first or last card", () => {
    expect(
      taskCardKeyIntent({ ...base, key: "ArrowUp", altKey: true, canMoveEarlier: false }),
    ).toBeNull();
    expect(
      taskCardKeyIntent({ ...base, key: "ArrowDown", altKey: true, canMoveLater: false }),
    ).toBeNull();
  });

  it("does not move while the board is busy, but still opens", () => {
    expect(taskCardKeyIntent({ ...base, key: "ArrowUp", altKey: true, busy: true })).toBeNull();
    expect(taskCardKeyIntent({ ...base, key: "Enter", busy: true })).toBe("open");
  });

  it("leaves unrelated keys alone", () => {
    expect(taskCardKeyIntent({ ...base, key: "a" })).toBeNull();
    expect(taskCardKeyIntent({ ...base, key: "Tab" })).toBeNull();
  });
});
