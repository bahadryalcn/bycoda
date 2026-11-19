import { describe, expect, it } from "vitest";
import {
  isDefaultQueueChord,
  queueChordConsumesKey,
  queueShortcutApplies,
} from "./composerQueue";

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

describe("queueChordConsumesKey", () => {
  it("lets Shift+Tab move focus back when nothing can be queued", () => {
    expect(queueChordConsumesKey(key, queueShortcutApplies({ ...running, busy: false }))).toBe(
      false,
    );
    expect(queueChordConsumesKey(key, queueShortcutApplies({ ...running, text: "" }))).toBe(false);
    expect(queueChordConsumesKey(key, queueShortcutApplies({ ...running, draftMode: true }))).toBe(
      false,
    );
    expect(queueChordConsumesKey(key, queueShortcutApplies({ ...running, disabled: true }))).toBe(
      false,
    );
  });

  it("takes Shift+Tab only while it queues a message", () => {
    expect(queueChordConsumesKey(key, queueShortcutApplies(running))).toBe(true);
  });

  it("always consumes a rebound non-Tab chord so it cannot fall through to send", () => {
    expect(queueChordConsumesKey({ key: "Enter" }, false)).toBe(true);
    expect(queueChordConsumesKey({ key: "Enter" }, true)).toBe(true);
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

  it("queues behind delegated subagents after the turn has ended", () => {
    expect(queueShortcutApplies({ ...running, busy: false, subagentsRunning: true })).toBe(true);
    expect(
      queueShortcutApplies({ ...running, busy: false, subagentsRunning: true, draftMode: true }),
    ).toBe(false);
  });

  it("leaves it alone with nothing to queue", () => {
    expect(queueShortcutApplies({ ...running, text: "  " })).toBe(false);
  });

  it("queues while only background commands keep the turn open", () => {
    expect(queueShortcutApplies({ ...running, backgroundOnly: true })).toBe(true);
  });

  it("leaves it alone for popups and drafts", () => {
    expect(queueShortcutApplies({ ...running, popupOpen: true })).toBe(false);
    expect(queueShortcutApplies({ ...running, draftMode: true })).toBe(false);
    expect(queueShortcutApplies({ ...running, allowBusySubmit: false })).toBe(false);
    expect(queueShortcutApplies({ ...running, disabled: true })).toBe(false);
  });

  it("never queues composer-only commands", () => {
    for (const text of [
      "/compact",
      "/clear",
      "/new",
      "/btw why",
      "/mcp",
      "/draft hi",
      "/add-to-folder",
    ]) {
      expect(queueShortcutApplies({ ...running, text })).toBe(false);
    }
  });
});
