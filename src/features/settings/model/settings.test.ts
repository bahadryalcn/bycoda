import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTOSAVE_DEFAULT,
  COLLAPSED_PROJECT_RAIL_MODE_DEFAULT,
  searchSettings,
  SETTINGS_INDEX,
  SETTINGS_SECTIONS,
  settingsSectionsByGroup,
  MODEL_CONTROLS_DEFAULT,
  DIFF_LAYOUT_DEFAULT,
  DIFF_VIEWER_DEFAULT,
  FORMAT_ON_SAVE_DEFAULT,
  FILE_TAB_MODE_DEFAULT,
  CREW_SCENE_ENABLED_DEFAULT,
  KEYBINDINGS,
  LIVE_AGENTS_ENABLED_DEFAULT,
  TAB_ANIMATIONS_ENABLED_DEFAULT,
  loadAutosave,
  loadCollapsedProjectRailMode,
  loadModelControls,
  loadDiffLayout,
  loadDiffViewer,
  loadKeybindingOverrides,
  loadFormatOnSave,
  loadFileTabMode,
  loadCrewSceneEnabled,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  keybindingPressed,
  matchCustomKeybinding,
  loadQuickComposerShortcut,
  loadTabAnimationsEnabled,
  NOTES_ENABLED_DEFAULT,
  saveAutosave,
  saveCollapsedProjectRailMode,
  saveModelControls,
  saveDiffLayout,
  saveDiffViewer,
  saveFormatOnSave,
  saveFileTabMode,
  saveCrewSceneEnabled,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
  saveKeybindingOverride,
  type KeybindingOverride,
  saveQuickComposerShortcut,
  saveTabAnimationsEnabled,
  CREW_GROWTH_ENABLED_DEFAULT,
  loadCrewGrowthEnabled,
  saveCrewGrowthEnabled,
  loadCrewTheme,
  saveCrewTheme,
} from "./settings";
import { ALT, IS_MAC, MOD, SHIFT } from "../../../platform/tauri/platform";
import { NOTES_PANEL_COMMAND } from "../../notes/notesPanel";

const MODEL_CONTROLS_KEY = "bycoda.modelControls";
const LEGACY_EFFORT_VISIBLE_KEY = "bycoda.composerEffortVisible";
const NOTES_KEY = "bycoda.notesEnabled";
const KEYBINDING_OVERRIDES_KEY = "bycoda.keybindingOverrides";
const QUICK_COMPOSER_SHORTCUT_KEY = "bycoda.quickComposerShortcut";
const LIVE_AGENTS_KEY = "bycoda.liveAgentsEnabled";
const CREW_SCENE_KEY = "bycoda.crewSceneEnabled";
const DIFF_VIEWER_KEY = "bycoda.diffViewer";
const DIFF_LAYOUT_KEY = "bycoda.diffLayout";
const FORMAT_ON_SAVE_KEY = "bycoda.formatOnSave";
const AUTOSAVE_KEY = "bycoda.autosave";
const FILE_TAB_MODE_KEY = "bycoda.fileTabMode";
const TAB_ANIMATIONS_KEY = "bycoda.tabAnimationsEnabled";
const COLLAPSED_PROJECT_RAIL_MODE_KEY = "bycoda.collapsedProjectRailMode";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("model controls setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(MODEL_CONTROLS_KEY);
    localStorage.removeItem(LEGACY_EFFORT_VISIBLE_KEY);
  });

  it("keeps options in the model menu by default", () => {
    expect(MODEL_CONTROLS_DEFAULT).toBe("menu");
    expect(loadModelControls()).toBe("menu");
  });

  it("persists the beside-picker preference", () => {
    saveModelControls("beside");
    expect(localStorage.getItem(MODEL_CONTROLS_KEY)).toBe("beside");
    expect(loadModelControls()).toBe("beside");
    saveModelControls("menu");
    expect(loadModelControls()).toBe("menu");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(MODEL_CONTROLS_KEY, "everywhere");
    expect(loadModelControls()).toBe("menu");
  });

  it("migrates the previous effort-control toggle", () => {
    localStorage.setItem(LEGACY_EFFORT_VISIBLE_KEY, "1");
    expect(loadModelControls()).toBe("beside");
    localStorage.setItem(LEGACY_EFFORT_VISIBLE_KEY, "0");
    localStorage.removeItem(MODEL_CONTROLS_KEY);
    expect(loadModelControls()).toBe("menu");
  });
});

describe("notes enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(NOTES_KEY);
  });

  it("defaults to on", () => {
    expect(NOTES_ENABLED_DEFAULT).toBe(true);
    expect(loadNotesEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveNotesEnabled(false);
    expect(localStorage.getItem(NOTES_KEY)).toBe("0");
    expect(loadNotesEnabled()).toBe(false);
    saveNotesEnabled(true);
    expect(loadNotesEnabled()).toBe(true);
  });
});

describe("keybinding overrides", () => {
  beforeEach(mockLocalStorage);

  const key = (
    code: string,
    modifiers: Partial<{
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
    }> = {},
  ) => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });

  it("persists a custom shortcut and matches only that combination", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Command+Shift+KeyM" });
    expect(localStorage.getItem(KEYBINDING_OVERRIDES_KEY)).toBe(
      '{"App: Search":{"shortcut":"Command+Shift+KeyM"}}',
    );
    expect(
      keybindingPressed("App: Search", key("KeyM", { metaKey: true, shiftKey: true }), true),
    ).toBe(true);
    expect(keybindingPressed("App: Search", key("KeyK", { metaKey: true }), true)).toBe(false);
    expect(matchCustomKeybinding(key("KeyM", { metaKey: true, shiftKey: true }))).toBe(
      "App: Search",
    );

    saveKeybindingOverride("App: Search", {});
    expect(localStorage.getItem(KEYBINDING_OVERRIDES_KEY)).toBeNull();
  });

  it("matches real keyboard events whose modifiers are prototype accessors", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Control+Shift+KeyM" });
    // Browsers define metaKey/ctrlKey/altKey/shiftKey on KeyboardEvent.prototype,
    // so they are not own properties and must be read, never spread.
    const prototyped = Object.create({
      code: "KeyM",
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
    }) as Parameters<typeof keybindingPressed>[1];

    expect(keybindingPressed("App: Search", prototyped, false)).toBe(true);
    expect(matchCustomKeybinding(prototyped)).toBe("App: Search");
  });

  it("serves a cached value without letting callers mutate it", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Command+KeyY" });
    const first = loadKeybindingOverrides();
    (first as Record<string, KeybindingOverride>)["App: Go to File"] = {
      disabled: true,
    };
    expect(loadKeybindingOverrides()["App: Go to File"]).toBeUndefined();
  });

  it("disables a shortcut and restores the default", () => {
    saveKeybindingOverride("App: Search", { disabled: true });
    expect(loadKeybindingOverrides()).toEqual({
      "App: Search": { disabled: true },
    });
    expect(keybindingPressed("App: Search", key("KeyK", { metaKey: true }), true)).toBe(false);
  });

  it("rejects a shortcut already used by another command", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Command+KeyY" });
    expect(() => saveKeybindingOverride("App: Go to File", { shortcut: "Command+KeyY" })).toThrow(
      "Already used by App: Search",
    );
  });

  it("rejects a shortcut that shadows another command's default", () => {
    // `App: Go to File` is bound to the platform modifier, so hardcoding
    // Control here clashes with nothing on macOS and the assertion passes
    // vacuously.
    const mod = IS_MAC ? "Command" : "Control";
    expect(() => saveKeybindingOverride("App: Search", { shortcut: `${mod}+KeyP` })).toThrow(
      "Already used by App: Go to File",
    );
    expect(() => saveKeybindingOverride("Tab: New", { shortcut: "Control+Tab" })).toThrow(
      "Already used by Tab: Cycle Next",
    );
  });

  it("protects every chord in the grouped tab activation range", () => {
    const mod = IS_MAC ? "Command" : "Control";
    for (const digit of [1, 4, 8]) {
      expect(() =>
        saveKeybindingOverride("App: Search", {
          shortcut: `${mod}+Digit${digit}`,
        }),
      ).toThrow("Already used by Tab: Activate 1–8");
    }
  });

  it("rejects a chord the command cannot use and invalid chords", () => {
    expect(() => saveKeybindingOverride("Tab: Activate 1–8", { shortcut: "Control+KeyM" })).toThrow(
      "needs a number key",
    );
    expect(() => saveKeybindingOverride("App: Search", { shortcut: "KeyK" })).toThrow(
      "not a valid shortcut",
    );
  });

  it("normalises modifier order when reading stored shortcuts", () => {
    localStorage.setItem(
      KEYBINDING_OVERRIDES_KEY,
      JSON.stringify({ "App: Search": { shortcut: "Shift+Command+KeyM" } }),
    );
    expect(loadKeybindingOverrides()).toEqual({
      "App: Search": { shortcut: "Command+Shift+KeyM" },
    });
  });

  it("ignores malformed, unknown, and invalid stored overrides", () => {
    localStorage.setItem(
      KEYBINDING_OVERRIDES_KEY,
      JSON.stringify({
        "Unknown: Command": { disabled: true },
        "App: Search": { shortcut: "KeyK" },
        "Tab: New": { shortcut: "Command+KeyT" },
      }),
    );
    expect(loadKeybindingOverrides()).toEqual({
      "Tab: New": { shortcut: "Command+KeyT" },
    });
    localStorage.setItem(KEYBINDING_OVERRIDES_KEY, "not-json");
    expect(loadKeybindingOverrides()).toEqual({});
  });
});

describe("quick composer shortcut setting", () => {
  beforeEach(mockLocalStorage);

  it("defaults to the existing shortcut and persists a custom binding", () => {
    expect(loadQuickComposerShortcut()).toBe("Command+Shift+Space");
    saveQuickComposerShortcut("Command+Option+KeyK");
    expect(localStorage.getItem(QUICK_COMPOSER_SHORTCUT_KEY)).toBe("Command+Option+KeyK");
    expect(loadQuickComposerShortcut()).toBe("Command+Option+KeyK");
  });

  it("ignores malformed stored bindings", () => {
    localStorage.setItem(QUICK_COMPOSER_SHORTCUT_KEY, "Shift+Space");
    expect(loadQuickComposerShortcut()).toBe("Command+Shift+Space");
  });
});

describe("live agents enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(LIVE_AGENTS_KEY);
  });

  it("defaults to on", () => {
    expect(LIVE_AGENTS_ENABLED_DEFAULT).toBe(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveLiveAgentsEnabled(false);
    expect(localStorage.getItem(LIVE_AGENTS_KEY)).toBe("0");
    expect(loadLiveAgentsEnabled()).toBe(false);
    saveLiveAgentsEnabled(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });
});

describe("crew scene enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(CREW_SCENE_KEY);
  });

  it("defaults to on", () => {
    expect(CREW_SCENE_ENABLED_DEFAULT).toBe(true);
    expect(loadCrewSceneEnabled()).toBe(true);
  });

  it("does not inherit the removed games preference", () => {
    localStorage.setItem("bycoda.gridArcadeEnabled", "0");
    expect(loadCrewSceneEnabled()).toBe(true);
    localStorage.removeItem("bycoda.gridArcadeEnabled");
  });

  it("persists an off switch", () => {
    saveCrewSceneEnabled(false);
    expect(localStorage.getItem(CREW_SCENE_KEY)).toBe("0");
    expect(loadCrewSceneEnabled()).toBe(false);
    saveCrewSceneEnabled(true);
    expect(loadCrewSceneEnabled()).toBe(true);
  });

  it("keeps an off switch saved under the scene's old coffeehouse name", () => {
    localStorage.setItem("bycoda.coffeehouseSceneEnabled", "0");
    expect(loadCrewSceneEnabled()).toBe(false);
    saveCrewSceneEnabled(true);
    expect(loadCrewSceneEnabled()).toBe(true);
    localStorage.removeItem("bycoda.coffeehouseSceneEnabled");
  });
});

describe("crew growth setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem("bycoda.crewGrowthEnabled");
  });

  it("defaults to on and persists an off switch", () => {
    expect(CREW_GROWTH_ENABLED_DEFAULT).toBe(true);
    expect(loadCrewGrowthEnabled()).toBe(true);
    saveCrewGrowthEnabled(false);
    expect(localStorage.getItem("bycoda.crewGrowthEnabled")).toBe("0");
    expect(loadCrewGrowthEnabled()).toBe(false);
  });
});

describe("crew theme setting", () => {
  beforeEach(mockLocalStorage);
  it("preserves the classic default, persists character themes, and recovers invalid stored values", () => {
    expect(loadCrewTheme()).toBe("classic");
    saveCrewTheme("star-wars");
    expect(localStorage.getItem("bycoda.crewTheme")).toBe("star-wars");
    expect(loadCrewTheme()).toBe("star-wars");
    saveCrewTheme("lotr");
    expect(loadCrewTheme()).toBe("lotr");
    saveCrewTheme("classic");
    expect(loadCrewTheme()).toBe("classic");
    localStorage.setItem("bycoda.crewTheme", "invalid-theme");
    expect(loadCrewTheme()).toBe("classic");
  });
});

describe("workspace navigation keybindings", () => {
  it("keeps separate shortcuts for the project rail and session sidebar", () => {
    expect(
      KEYBINDINGS.filter((row) =>
        ["App: Toggle Sidebar", "App: Toggle Session Sidebar"].includes(row.command),
      ),
    ).toEqual([
      { command: "App: Toggle Sidebar", keys: `${MOD}B`, when: "Always" },
      {
        command: "App: Toggle Session Sidebar",
        keys: `${MOD}${SHIFT}B`,
        when: "Always",
      },
    ]);
  });
  it("documents the command palette and reload shortcuts", () => {
    expect(
      KEYBINDINGS.filter((row) => ["App: Command Palette", "View: Reload"].includes(row.command)),
    ).toEqual([
      {
        command: "App: Command Palette",
        keys: `${MOD}${SHIFT}P`,
        when: "Always",
      },
      {
        command: "View: Reload",
        keys: `${MOD}${SHIFT}R`,
        when: "Always",
      },
    ]);
  });
  it("documents the draft workspace toggle", () => {
    expect(KEYBINDINGS.find((row) => row.command === "Composer: Toggle Workspace")).toEqual({
      command: "Composer: Toggle Workspace",
      keys: `${MOD}${SHIFT}G`,
      when: "Draft session composer",
    });
  });
  it("documents session and project cycling in the shortcut list", () => {
    const rows = KEYBINDINGS.filter((row) =>
      /^(Session|Project): (Previous|Next)$/.test(row.command),
    );
    expect(rows.map((row) => row.command)).toEqual([
      "Session: Previous",
      "Session: Next",
      "Project: Previous",
      "Project: Next",
    ]);
    expect(rows.every((row) => row.when === "!overlay && (!textFocus || emptyComposer)")).toBe(
      true,
    );
  });
  it("documents the notes panel toggle on a chord nothing else owns", () => {
    expect(KEYBINDINGS.find((row) => row.command === NOTES_PANEL_COMMAND)).toEqual({
      command: NOTES_PANEL_COMMAND,
      keys: `${MOD}${ALT}N`,
      when: "sessionFocus && !overlay",
    });
    expect(KEYBINDINGS.filter((row) => row.keys === `${MOD}N`)).toHaveLength(1);
    expect(KEYBINDINGS.find((row) => row.keys === `${MOD}N`)?.command).toBe("Session: New");
  });
  describe("notes panel rebinding", () => {
    beforeEach(mockLocalStorage);
    afterEach(() => localStorage.removeItem(KEYBINDING_OVERRIDES_KEY));

    const ctrlN = {
      code: "KeyN",
      metaKey: IS_MAC,
      ctrlKey: !IS_MAC,
      altKey: true,
      shiftKey: false,
    };

    it("fires on the default chord and honours a rebind or disable", () => {
      expect(keybindingPressed(NOTES_PANEL_COMMAND, ctrlN, true)).toBe(true);
      saveKeybindingOverride(NOTES_PANEL_COMMAND, { shortcut: "Option+KeyM" });
      expect(keybindingPressed(NOTES_PANEL_COMMAND, ctrlN, true)).toBe(false);
      saveKeybindingOverride(NOTES_PANEL_COMMAND, { disabled: true });
      expect(keybindingPressed(NOTES_PANEL_COMMAND, ctrlN, true)).toBe(false);
    });

    it("refuses to give the notes chord to another command", () => {
      expect(() =>
        saveKeybindingOverride("Tab: New", {
          shortcut: IS_MAC ? "Command+Option+KeyN" : "Control+Option+KeyN",
        }),
      ).toThrow(`Already used by ${NOTES_PANEL_COMMAND}`);
    });

    it("lets a command already moved onto the chord by the user keep it", () => {
      saveKeybindingOverride("Tab: New", { shortcut: "Option+KeyN" });
      expect(loadKeybindingOverrides()["Tab: New"]).toEqual({
        shortcut: "Option+KeyN",
      });
    });
  });
  it("documents same-tab session switching", () => {
    expect(KEYBINDINGS.filter((row) => row.command.includes("in Current Tab"))).toEqual([
      {
        command: "Session: Previous in Current Tab",
        keys: `${MOD}↑`,
        when: "!overlay && (!textFocus || emptyComposer)",
      },
      {
        command: "Session: Next in Current Tab",
        keys: `${MOD}↓`,
        when: "!overlay && (!textFocus || emptyComposer)",
      },
    ]);
  });
});

describe("format on save setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(FORMAT_ON_SAVE_KEY);
  });

  it("defaults to on", () => {
    expect(FORMAT_ON_SAVE_DEFAULT).toBe(true);
    expect(loadFormatOnSave()).toBe(true);
  });

  it("persists an off switch", () => {
    saveFormatOnSave(false);
    expect(localStorage.getItem(FORMAT_ON_SAVE_KEY)).toBe("0");
    expect(loadFormatOnSave()).toBe(false);
    saveFormatOnSave(true);
    expect(loadFormatOnSave()).toBe(true);
  });
});

describe("autosave setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(AUTOSAVE_KEY);
  });

  it("defaults to off and persists changes", () => {
    expect(AUTOSAVE_DEFAULT).toBe(false);
    expect(loadAutosave()).toBe(false);
    saveAutosave(true);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBe("1");
    expect(loadAutosave()).toBe(true);
  });
});

describe("diff viewer setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(DIFF_VIEWER_KEY);
  });

  it("defaults to the editor layout", () => {
    expect(DIFF_VIEWER_DEFAULT).toBe("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("persists the unified layout", () => {
    saveDiffViewer("unified");
    expect(localStorage.getItem(DIFF_VIEWER_KEY)).toBe("unified");
    expect(loadDiffViewer()).toBe("unified");
    saveDiffViewer("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(DIFF_VIEWER_KEY, "split");
    expect(loadDiffViewer()).toBe("editor");
  });
});

describe("diff layout setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(DIFF_LAYOUT_KEY);
  });

  it("defaults to the inline layout", () => {
    expect(DIFF_LAYOUT_DEFAULT).toBe("inline");
    expect(loadDiffLayout()).toBe("inline");
  });

  it("persists the split layout", () => {
    saveDiffLayout("split");
    expect(localStorage.getItem(DIFF_LAYOUT_KEY)).toBe("split");
    expect(loadDiffLayout()).toBe("split");
    saveDiffLayout("inline");
    expect(loadDiffLayout()).toBe("inline");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(DIFF_LAYOUT_KEY, "side-by-side");
    expect(loadDiffLayout()).toBe("inline");
  });
});

describe("file tab mode setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(FILE_TAB_MODE_KEY);
  });

  it("opens files beside chat by default", () => {
    expect(FILE_TAB_MODE_DEFAULT).toBe("pane");
    expect(loadFileTabMode()).toBe("pane");
  });

  it("persists top-level file tabs", () => {
    saveFileTabMode("workspace");
    expect(localStorage.getItem(FILE_TAB_MODE_KEY)).toBe("workspace");
    expect(loadFileTabMode()).toBe("workspace");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(FILE_TAB_MODE_KEY, "window");
    expect(loadFileTabMode()).toBe("pane");
  });
});

describe("tab animations setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(TAB_ANIMATIONS_KEY);
  });

  it("defaults to off", () => {
    expect(TAB_ANIMATIONS_ENABLED_DEFAULT).toBe(false);
    expect(loadTabAnimationsEnabled()).toBe(false);
  });

  it("persists an off switch", () => {
    saveTabAnimationsEnabled(false);
    expect(localStorage.getItem(TAB_ANIMATIONS_KEY)).toBe("0");
    expect(loadTabAnimationsEnabled()).toBe(false);
    saveTabAnimationsEnabled(true);
    expect(loadTabAnimationsEnabled()).toBe(true);
  });
});

describe("collapsed project rail setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(COLLAPSED_PROJECT_RAIL_MODE_KEY);
  });

  it("defaults to the icon rail", () => {
    expect(COLLAPSED_PROJECT_RAIL_MODE_DEFAULT).toBe("compact");
    expect(loadCollapsedProjectRailMode()).toBe("compact");
  });

  it("persists the hidden mode and ignores unknown values", () => {
    saveCollapsedProjectRailMode("hidden");
    expect(localStorage.getItem(COLLAPSED_PROJECT_RAIL_MODE_KEY)).toBe("hidden");
    expect(loadCollapsedProjectRailMode()).toBe("hidden");

    localStorage.setItem(COLLAPSED_PROJECT_RAIL_MODE_KEY, "floating");
    expect(loadCollapsedProjectRailMode()).toBe("compact");
  });
});

describe("settings navigation", () => {
  it("lists every section under exactly one rail group", () => {
    const groups = settingsSectionsByGroup();
    expect(groups.map((group) => group.label)).toEqual(["App", "Workspace", "Agents", "About"]);
    expect(groups.at(-1)?.sections.map((section) => section.id)).toEqual(["policies"]);
    const ids = groups.flatMap((group) => group.sections.map((section) => section.id));
    expect(ids).toHaveLength(19);
    expect(new Set(ids).size).toBe(19);
    expect([...ids].sort()).toEqual(SETTINGS_SECTIONS.map((section) => section.id).sort());
    for (const group of groups) {
      expect(group.sections.every((section) => section.group === group.id)).toBe(true);
    }
  });

  it("points every indexed setting at a real section", () => {
    const sections = new Set(
      settingsSectionsByGroup().flatMap((group) => group.sections.map((section) => section.id)),
    );
    for (const entry of SETTINGS_INDEX) {
      expect(sections.has(entry.section), entry.id).toBe(true);
    }
  });
});

describe("settings search", () => {
  it("returns nothing for an empty query", () => {
    expect(searchSettings("   ")).toEqual([]);
  });

  it("ranks label matches over keyword matches, and pages last", () => {
    expect(searchSettings("glass").map((result) => result.label)).toEqual([
      "Main pane glass",
      "Window glass",
      "Blur radius",
      "Main pane opacity",
      "Sidebar opacity",
      "Appearance",
    ]);
  });

  it("finds a setting by a word that is not in its label", () => {
    expect(searchSettings("steer")[0]).toMatchObject({
      section: "chat",
      sectionLabel: "Chat",
      settingId: "follow-up",
      label: "Sending while working",
    });

    expect(searchSettings("prettier")[0]).toMatchObject({
      section: "workspace",
      settingId: "format-on-save",
      label: "Format on save",
    });
  });

  it("returns a whole page with no setting id", () => {
    // Settings that mention skills (such as File access) follow the page itself.
    expect(searchSettings("skills")[0]).toEqual({
      section: "skills",
      sectionLabel: "Skills",
      settingId: null,
      label: "Skills",
    });
  });

  it("caps the result list", () => {
    expect(searchSettings("e", 4)).toHaveLength(4);
  });
});
