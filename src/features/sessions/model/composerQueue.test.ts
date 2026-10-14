import { describe, expect, it } from "vitest";
import { isDefaultQueueChord, queueShortcutApplies } from "./composerQueue";

const running = {
  busy: true,
  backgroundOnly: false,
  allowBusySubmit: true,
  disabled: false,
  popupOpen: false,
  draftMode: false,
  text: "also update the docs",
  attachmentCount: 0,
};

const key = { key: "Tab", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false };

describe("isDefaultQueueChord", () => {
  it("is Shift+Tab and nothing else", () => {
    expect(isDefaultQueueChord(key)).toBe(true);
    expect(isDefaultQueueChord({ ...key, shiftKey: false })).toBe(false);
    expect(isDefaultQueueChord({ ...key, ctrlKey: true })).toBe(false);
    expect(isDefaultQueueChord({ ...key, key: "Enter" })).toBe(false);
  });
});

describe("queueShortcutApplies", () => {
  it("queues a typed message while a turn runs", () => {
    expect(queueShortcutApplies(running)).toBe(true);
    expect(queueShortcutApplies({ ...running, text: "", attachmentCount: 1 })).toBe(true);
  });

  it("leaves Shift+Tab alone when idle", () => {
    expect(queueShortcutApplies({ ...running, busy: false })).toBe(false);
  });

  it("leaves it alone with nothing to queue", () => {
    expect(queueShortcutApplies({ ...running, text: "  " })).toBe(false);
  });

  it("leaves it alone for background-only turns, popups and drafts", () => {
    expect(queueShortcutApplies({ ...running, backgroundOnly: true })).toBe(false);
    expect(queueShortcutApplies({ ...running, popupOpen: true })).toBe(false);
    expect(queueShortcutApplies({ ...running, draftMode: true })).toBe(false);
    expect(queueShortcutApplies({ ...running, allowBusySubmit: false })).toBe(false);
    expect(queueShortcutApplies({ ...running, disabled: true })).toBe(false);
  });

  it("never queues composer-only commands", () => {
    for (const text of ["/compact", "/btw why", "/mcp", "/draft hi", "/add-to-folder"]) {
      expect(queueShortcutApplies({ ...running, text })).toBe(false);
    }
  });
});
