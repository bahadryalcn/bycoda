import { describe, expect, it } from "vitest";
import {
  composerEscapeAction,
  DOUBLE_ESCAPE_MS,
  isDefaultStopChord,
  isInterruptChord,
} from "./sessionKeys";

const bare = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

describe("isDefaultStopChord", () => {
  it("is bare Escape only", () => {
    expect(isDefaultStopChord({ ...bare, key: "Escape" })).toBe(true);
    expect(isDefaultStopChord({ ...bare, key: "Escape", shiftKey: true })).toBe(false);
    expect(isDefaultStopChord({ ...bare, key: "Enter" })).toBe(false);
  });
});

describe("isInterruptChord", () => {
  const ctrlC = { ...bare, key: "c", code: "KeyC", ctrlKey: true };

  it("is Ctrl+C with nothing selected", () => {
    expect(isInterruptChord(ctrlC, false)).toBe(true);
    expect(isInterruptChord(ctrlC, true)).toBe(false);
  });

  it("ignores Command+C and other modifiers", () => {
    expect(isInterruptChord({ ...ctrlC, ctrlKey: false, metaKey: true }, false)).toBe(false);
    expect(isInterruptChord({ ...ctrlC, shiftKey: true }, false)).toBe(false);
  });
});

describe("composerEscapeAction", () => {
  const idle = {
    editingLastTurn: false,
    empty: true,
    canRecall: true,
    armedAt: null,
    now: 10_000,
  };

  it("leaves edit mode first", () => {
    expect(composerEscapeAction({ ...idle, editingLastTurn: true })).toBe("exit-edit");
  });

  it("recalls the last message on Esc Esc", () => {
    expect(composerEscapeAction(idle)).toBe("arm");
    expect(composerEscapeAction({ ...idle, armedAt: idle.now - 100 })).toBe("recall");
    expect(composerEscapeAction({ ...idle, armedAt: idle.now - DOUBLE_ESCAPE_MS - 1 })).toBe("arm");
  });

  it("does nothing with text or nothing to recall", () => {
    expect(composerEscapeAction({ ...idle, empty: false })).toBeNull();
    expect(composerEscapeAction({ ...idle, canRecall: false })).toBeNull();
  });
});
