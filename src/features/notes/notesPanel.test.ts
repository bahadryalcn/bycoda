import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampNotesPanelWidth,
  getNotesPanelOpen,
  NOTES_PANEL_DEFAULT_WIDTH,
  NOTES_PANEL_MAX_WIDTH,
  NOTES_PANEL_MIN_WIDTH,
  panelNotes,
  parseNotesPanelWidth,
  pickPanelNote,
  setNotesPanelOpen,
  shouldToggleNotesPanel,
  subscribeNotesPanel,
  takeNotesPanelFocusRequest,
  toggleNotesPanel,
} from "./notesPanel";
import type { Note } from "./notes";

function note(id: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    slug: id,
    title: id,
    body: "",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

describe("notes panel width", () => {
  it("clamps to the min and to half the window up to the max", () => {
    expect(clampNotesPanelWidth(10, 1600)).toBe(NOTES_PANEL_MIN_WIDTH);
    expect(clampNotesPanelWidth(5000, 1600)).toBe(NOTES_PANEL_MAX_WIDTH);
    expect(clampNotesPanelWidth(5000, 800)).toBe(400);
    expect(clampNotesPanelWidth(400, 300)).toBe(NOTES_PANEL_MIN_WIDTH);
    expect(clampNotesPanelWidth(NaN, 1600)).toBe(NOTES_PANEL_DEFAULT_WIDTH);
  });

  it("falls back to the default for a missing or corrupt stored width", () => {
    expect(parseNotesPanelWidth(null)).toBe(NOTES_PANEL_DEFAULT_WIDTH);
    expect(parseNotesPanelWidth("")).toBe(NOTES_PANEL_DEFAULT_WIDTH);
    expect(parseNotesPanelWidth("wide")).toBe(NOTES_PANEL_DEFAULT_WIDTH);
    expect(parseNotesPanelWidth("412")).toBe(412);
  });
});

describe("notes panel open state", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    });
    takeNotesPanelFocusRequest();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts closed, toggles, persists and notifies", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNotesPanel(listener);
    expect(getNotesPanelOpen()).toBe(false);
    toggleNotesPanel();
    expect(getNotesPanelOpen()).toBe(true);
    expect(localStorage.getItem("bycoda.notesPanelOpen")).toBe("1");
    toggleNotesPanel();
    expect(getNotesPanelOpen()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    setNotesPanelOpen(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    toggleNotesPanel();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("asks for editor focus once per explicit open", () => {
    setNotesPanelOpen(true, 1000);
    expect(takeNotesPanelFocusRequest(1200)).toBe(true);
    expect(takeNotesPanelFocusRequest(1201)).toBe(false);
  });

  it("does not steal focus for an open request that went stale", () => {
    setNotesPanelOpen(true, 1000);
    expect(takeNotesPanelFocusRequest(5000)).toBe(false);
  });

  it("does not request focus when closing", () => {
    setNotesPanelOpen(true, 1000);
    takeNotesPanelFocusRequest(1000);
    setNotesPanelOpen(false, 1100);
    expect(takeNotesPanelFocusRequest(1100)).toBe(false);
  });
});

describe("shouldToggleNotesPanel", () => {
  const base = {
    enabled: true,
    activeTabId: "t1",
    tabs: [{ id: "t1", focusedId: "s1" }],
    sessions: [{ id: "s1" }],
    projectTerminalFocused: false,
    surfaceOpen: false,
    inSessionArea: true,
  };

  it("applies while a session view is focused", () => {
    expect(shouldToggleNotesPanel(base)).toBe(true);
  });

  it.each([
    ["notes are disabled", { enabled: false }],
    ["the project terminal is focused", { projectTerminalFocused: true }],
    ["another surface is open", { surfaceOpen: true }],
    ["focus is outside the session", { inSessionArea: false }],
    ["a diff is focused", { tabs: [{ id: "t1", focusedId: "s1", diffFocused: true }] }],
    ["the focused pane is not a session", { sessions: [] }],
    ["there is no active tab", { activeTabId: "gone" }],
  ])("does not apply when %s", (_name, change) => {
    expect(shouldToggleNotesPanel({ ...base, ...change })).toBe(false);
  });
});

describe("panelNotes and pickPanelNote", () => {
  const notes = [
    note("old-session", { sourceSessionId: "s1", sourceCwd: "/p", updatedAt: 1 }),
    note("new-session", { sourceSessionId: "s1", sourceCwd: "/p", updatedAt: 5 }),
    note("project-new", { sourceSessionId: "s2", sourceCwd: "/p/", updatedAt: 9 }),
    note("project-old", { sourceCwd: "/p", updatedAt: 3 }),
    note("other-project", { sourceCwd: "/q", updatedAt: 99 }),
    note("loose", { updatedAt: 100 }),
  ];

  it("puts this session first, then the project's other notes", () => {
    const offered = panelNotes(notes, "s1", "/p");
    expect(offered.session.map((n) => n.id)).toEqual(["new-session", "old-session"]);
    expect(offered.project.map((n) => n.id)).toEqual(["project-new", "project-old"]);
  });

  it("keeps a session note even when its project was moved", () => {
    const moved = [note("m", { sourceSessionId: "s1", sourceCwd: "/elsewhere" })];
    expect(panelNotes(moved, "s1", "/p").session.map((n) => n.id)).toEqual(["m"]);
  });

  it("compares Windows project paths case-insensitively", () => {
    const win = [note("w", { sourceCwd: "C:/Work/App" })];
    expect(panelNotes(win, "s9", "c:/work/app").project).toHaveLength(1);
  });

  it("matches remote projects by their full path", () => {
    const remote = [
      note("r1", { sourceCwd: "remote://env-a/srv/app" }),
      note("r2", { sourceCwd: "remote://env-b/srv/app" }),
    ];
    expect(panelNotes(remote, "s1", "remote://env-a/srv/app").project.map((n) => n.id)).toEqual([
      "r1",
    ]);
  });

  it("offers nothing without a project or session link", () => {
    expect(panelNotes(notes, "none", "")).toEqual({ session: [], project: [] });
  });

  it("picks an explicit selection or a session note, never defaults to a project note", () => {
    const offered = panelNotes(notes, "s1", "/p");
    expect(pickPanelNote(offered, "project-old")?.id).toBe("project-old");
    expect(pickPanelNote(offered, "deleted")?.id).toBe("new-session");
    expect(pickPanelNote(offered)?.id).toBe("new-session");
    expect(pickPanelNote(panelNotes(notes, "s9", "/p"))).toBeNull();
    expect(pickPanelNote(panelNotes([], "s1", "/p"))).toBeNull();
  });
});
