// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as settings from "./settings";
import * as appearance from "./appearance";
import { DEFAULT_AGENT_DEFAULTS } from "../../tasks/public/agentDefaults";
import { acceptAgentDefaults, registerAgentDefaultsSync } from "./agentDefaultsStore";

const platform = vi.hoisted(() => ({ isWindows: true }));
vi.mock("../../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/platform")>()),
  get IS_WIN() {
    return platform.isWindows;
  },
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  platform.isWindows = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Change events that carry no detail payload. */
const NO_DETAIL = new Set(["bycoda.minimizeToTray", "bycoda.tabAnimationsEnabled"]);
/** Appearance flags keep the applied value for this window when the write fails. */
const APPLIED_ON_FAILURE = new Set(["bycoda.bodyGlass"]);
/** Stored flags publish only after the change is persisted. */
const CONFIRMED_EVENTS = new Set([
  "bycoda.notesEnabled",
  "bycoda.liveAgentsEnabled",
  "bycoda.keepAwakeScreen",
  "bycoda.claudeHooks",
]);

describe.each([
  [
    "bycoda.tabAnimationsEnabled",
    settings.loadTabAnimationsEnabled,
    settings.saveTabAnimationsEnabled,
    false,
    "bycoda:tab-animations-change",
  ],
  [
    "bycoda.notesEnabled",
    settings.loadNotesEnabled,
    settings.saveNotesEnabled,
    true,
    "bycoda:notes-enabled-change",
  ],
  [
    "bycoda.liveAgentsEnabled",
    settings.loadLiveAgentsEnabled,
    settings.saveLiveAgentsEnabled,
    true,
    "bycoda:live-agents-enabled-change",
  ],
  [
    "bycoda.keepAwakeScreen",
    settings.loadKeepAwakeScreen,
    settings.saveKeepAwakeScreen,
    false,
    settings.KEEP_AWAKE_SCREEN_CHANGE_EVENT,
  ],
  [
    "bycoda.minimizeToTray",
    settings.loadMinimizeToTray,
    settings.saveMinimizeToTray,
    false,
    "bycoda:minimize-to-tray-change",
  ],
  [
    "bycoda.crewSceneEnabled",
    settings.loadCrewSceneEnabled,
    settings.saveCrewSceneEnabled,
    true,
    "bycoda:crew-scene-enabled-change",
  ],
  [
    "bycoda.claudeHooks",
    settings.loadClaudeHooks,
    settings.saveClaudeHooks,
    true,
    "bycoda:claude-hooks-change",
  ],
  [
    "bycoda.bodyGlass",
    appearance.loadBodyGlass,
    appearance.saveBodyGlass,
    appearance.BODY_GLASS_DEFAULT,
    "bycoda:sharedappearancechange",
  ],
  [
    "bycoda.projectRailOpen",
    appearance.loadProjectRailOpen,
    appearance.saveProjectRailOpen,
    true,
    undefined,
  ],
  [
    "bycoda.sessionSidebarOpen",
    appearance.loadSessionSidebarOpen,
    appearance.saveSessionSidebarOpen,
    true,
    undefined,
  ],
  [
    "bycoda.transcriptAnchor",
    appearance.loadTranscriptAnchor,
    appearance.saveTranscriptAnchor,
    true,
    "bycoda:transcriptanchorchange",
  ],
] as const)("%s", (key, load, save, fallback, eventName) => {
  it("uses its default when unset or unreadable", () => {
    expect(load()).toBe(fallback);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(load()).toBe(fallback);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["", false],
    ["TRUE", false],
    [" true ", false],
    ["invalid", false],
  ] as const)("reads %j as %s", (stored, expected) => {
    localStorage.setItem(key, stored);
    expect(load()).toBe(expected);
  });

  it.each([false, true])("persists %s before notifying listeners", (value) => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const listener = vi.fn((event: Event) => {
      expect(event.type).toBe(eventName);
      if (!NO_DETAIL.has(key)) {
        expect((event as CustomEvent<boolean | string>).detail).toBe(
          key === "bycoda.bodyGlass" ? key : value,
        );
      }
      expect(load()).toBe(value);
    });
    if (eventName) window.addEventListener(eventName, listener);
    try {
      save(value);
      expect(localStorage.getItem(key)).toBe(value ? "1" : "0");
      expect(localStorage.length).toBe(1);
      expect(load()).toBe(value);
      expect(dispatch).toHaveBeenCalledTimes(eventName ? 1 : 0);
      expect(listener).toHaveBeenCalledTimes(eventName ? 1 : 0);
    } finally {
      if (eventName) window.removeEventListener(eventName, listener);
    }
  });

  it("follows the flag's change notification contract when writing fails", () => {
    const value = !fallback;
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage quota exceeded");
    });

    try {
      expect(() => save(value)).not.toThrow();
      // Appearance keeps the applied value in this window; other flags keep the stored value.
      expect(load()).toBe(APPLIED_ON_FAILURE.has(key) ? value : fallback);
      const emits = eventName && !CONFIRMED_EVENTS.has(key);
      expect(dispatch).toHaveBeenCalledTimes(emits ? 1 : 0);
      if (emits) {
        expect(dispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            type: eventName,
            ...(NO_DETAIL.has(key) ? {} : { detail: key === "bycoda.bodyGlass" ? key : value }),
          }),
        );
      }
    } finally {
      // A later successful write clears the window-only fallback for the next test.
      setItem.mockRestore();
      save(fallback);
    }
  });

  it("tolerates unavailable storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(load()).toBe(fallback);
    expect(() => save(!fallback)).not.toThrow();
  });

  it("can persist without a window", () => {
    vi.stubGlobal("window", undefined);
    save(!fallback);
    expect(load()).toBe(!fallback);
  });
});

it("disables minimize-to-tray outside Windows without consulting storage", () => {
  platform.isWindows = false;
  settings.saveMinimizeToTray(true);
  const read = vi.spyOn(localStorage, "getItem");

  expect(settings.loadMinimizeToTray()).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

/** Preferences the Host owns: storage is only a legacy source until the Host accepts a record. */
const HOST_OWNED = [
  ["bycoda.keepAwakeWhileAgentsWork", "keepAwakeWhileAgentsWork", false],
  ["bycoda.resumeAtReset", "resumeAtReset", true],
  ["bycoda.autoContinueInterrupted", "autoContinueInterrupted", true],
] as const;
const hostLoad = {
  keepAwakeWhileAgentsWork: settings.loadKeepAwakeEnabled,
  resumeAtReset: settings.loadResumeAtReset,
  autoContinueInterrupted: settings.loadAutoContinueInterrupted,
};
const hostSave = {
  keepAwakeWhileAgentsWork: settings.saveKeepAwakeEnabled,
  resumeAtReset: settings.saveResumeAtReset,
  autoContinueInterrupted: settings.saveAutoContinueInterrupted,
};
const acceptHost = (patch: Partial<typeof DEFAULT_AGENT_DEFAULTS>, version: number) =>
  acceptAgentDefaults({ agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, version, ...patch } });

// These run before any Host record is accepted, so the module snapshot is still empty.
describe.each(HOST_OWNED)("%s before the Host answers", (storageKey, key, fallback) => {
  it("uses its default when unset or unreadable", () => {
    expect(hostLoad[key]()).toBe(fallback);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(hostLoad[key]()).toBe(fallback);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["invalid", false],
  ] as const)("reads the legacy value %j as %s", (stored, expected) => {
    localStorage.setItem(storageKey, stored);
    expect(hostLoad[key]()).toBe(expected);
  });
});

it("reads the legacy keep-awake hold only until the Host answers", () => {
  expect(settings.loadKeepAwakeHoldAfter()).toBe("0");
  localStorage.setItem("bycoda.keepAwakeHoldAfter", "15m");
  expect(settings.loadKeepAwakeHoldAfter()).toBe("15m");
  localStorage.setItem("bycoda.keepAwakeHoldAfter", "nope");
  expect(settings.loadKeepAwakeHoldAfter()).toBe("0");
  expect(settings.keepAwakeHoldAfterMs("15m")).toBe(15 * 60 * 1000);
  expect(settings.keepAwakeHoldAfterMs("forever")).toBe(Number.POSITIVE_INFINITY);
});

describe("after the Host accepts a record", () => {
  const save = vi.fn(async () => true);
  beforeEach(() => {
    save.mockClear();
    registerAgentDefaultsSync({ start: () => () => {}, save });
    acceptHost({}, 1);
  });

  it.each(HOST_OWNED)(
    "%s forwards a save and changes only after the Host acknowledges it",
    (storageKey, key, fallback) => {
      const listener = vi.fn();
      const unsubscribe = settings.subscribeKeepAwakeEnabled(listener);
      try {
        expect(hostSave[key](!fallback)).toBe(false);
        expect(save).toHaveBeenCalledWith(key, !fallback);
        expect(hostLoad[key]()).toBe(fallback);
        expect(listener).not.toHaveBeenCalled();
        expect(localStorage.getItem(storageKey)).toBeNull();
        acceptHost({ [key]: !fallback }, 2);
        expect(hostLoad[key]()).toBe(!fallback);
        expect(listener).toHaveBeenCalledTimes(1);
        // Once the snapshot already holds the value, the save is durable.
        expect(hostSave[key](!fallback)).toBe(true);
      } finally {
        unsubscribe();
      }
    },
  );

  it("ignores legacy storage once the Host owns the value", () => {
    localStorage.setItem("bycoda.keepAwakeWhileAgentsWork", "1");
    localStorage.setItem("bycoda.keepAwakeHoldAfter", "1h");
    expect(settings.loadKeepAwakeEnabled()).toBe(false);
    expect(settings.loadKeepAwakeHoldAfter()).toBe("0");
  });

  it("persists how long to stay awake after an agent ends through the Host", () => {
    settings.saveKeepAwakeHoldAfter("15m");
    expect(save).toHaveBeenCalledWith("keepAwakeHoldAfter", "15m");
    expect(settings.loadKeepAwakeHoldAfter()).toBe("0");
    acceptHost({ keepAwakeHoldAfter: "15m" }, 2);
    expect(settings.loadKeepAwakeHoldAfter()).toBe("15m");
  });

  it("reads keep-awake on Linux and macOS from the Host record", () => {
    platform.isWindows = false;
    acceptHost({ keepAwakeWhileAgentsWork: true }, 2);
    expect(settings.loadKeepAwakeEnabled()).toBe(true);
  });

  it("notifies another window's change through the Host snapshot, not storage events", () => {
    const listener = vi.fn();
    const unsubscribe = settings.subscribeKeepAwakeEnabled(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.keepAwakeWhileAgentsWork" }));
    expect(listener).not.toHaveBeenCalled();
    acceptHost({ keepAwakeWhileAgentsWork: true }, 2);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    acceptHost({ keepAwakeWhileAgentsWork: false }, 3);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
