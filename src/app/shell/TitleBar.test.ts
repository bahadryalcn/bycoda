import { describe, expect, it } from "vitest";
import {
  tabCopy,
  tabStripOverflow,
  titleTabContextCloseIds,
  titleTabCanMoveToNewWindow,
  titleTabClosable,
  type Tab,
} from "./TitleBar";

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "t1",
    project: "agent-terminal",
    title: "",
    more: [],
    sessionCount: 1,
    harnesses: [],
    busyHarnesses: [],
    files: [],
    ...overrides,
  };
}

describe("tabCopy", () => {
  it("layers conversation and file when split across panes", () => {
    const focusedSession = tabCopy(
      tab({
        multiPane: true,
        title: "Add custom project logos",
        files: ["opencodeAdapter.ts"],
      }),
    );
    expect(focusedSession).toEqual({
      headline: "Add custom project logos",
      meta: "opencodeAdapter.ts",
      tooltip: "agent-terminal · Add custom project logos · opencodeAdapter.ts",
    });

    const focusedFile = tabCopy(
      tab({
        multiPane: true,
        fileFocused: true,
        title: "Add custom project logos",
        files: ["opencodeAdapter.ts"],
      }),
    );
    expect(focusedFile).toEqual({
      headline: "Add custom project logos",
      meta: "opencodeAdapter.ts",
      tooltip: "agent-terminal · Add custom project logos · opencodeAdapter.ts",
    });
    expect(focusedFile).toEqual(focusedSession);
  });

  it("keeps the conversation headline when switching focused files", () => {
    const copy = tabCopy(
      tab({
        multiPane: true,
        fileFocused: true,
        title: "Review pending monocode changes",
        files: ["host-tools.css", "TitleBar.tsx"],
      }),
    );
    expect(copy.headline).toBe("Review pending monocode changes");
    expect(copy.meta).toBe("host-tools.css");
  });

  it("uses the file headline when the tab has no conversation", () => {
    const copy = tabCopy(
      tab({
        multiPane: true,
        fileFocused: true,
        sessionCount: 0,
        files: ["host-tools.css"],
      }),
    );
    expect(copy.headline).toBe("host-tools.css");
    expect(copy.meta).toBe("");
  });

  it("layers two conversations in split panes", () => {
    const copy = tabCopy(
      tab({
        multiPane: true,
        title: "First chat",
        more: ["Second chat"],
        sessionCount: 2,
      }),
    );
    expect(copy.headline).toBe("First chat");
    expect(copy.meta).toBe("Second chat");
  });

  it("keeps a single-line title for one pane with only a conversation", () => {
    const copy = tabCopy(
      tab({
        title: "Only chat",
        project: "agent-terminal",
      }),
    );
    expect(copy.headline).toBe("Only chat");
    expect(copy.meta).toBe("");
  });

  it("labels an empty tab New session", () => {
    const copy = tabCopy(tab({ project: "agent-terminal" }));
    expect(copy.headline).toBe("New session");
    expect(copy.meta).toBe("");
  });
});

describe("tabStripOverflow", () => {
  it("hides both chevrons when the strip fits", () => {
    expect(tabStripOverflow(0, 400, 400)).toEqual({
      left: false,
      right: false,
    });
  });

  it("shows only the right chevron at the start", () => {
    expect(tabStripOverflow(0, 400, 800)).toEqual({ left: false, right: true });
  });

  it("shows both chevrons in the middle", () => {
    expect(tabStripOverflow(200, 400, 800)).toEqual({
      left: true,
      right: true,
    });
  });

  it("shows only the left chevron at the end", () => {
    expect(tabStripOverflow(400, 400, 800)).toEqual({
      left: true,
      right: false,
    });
  });
});

describe("titleTabClosable", () => {
  it("hides close on a sole blank tab", () => {
    expect(titleTabClosable(tab({ blank: true }), 1)).toBe(false);
  });

  it("shows close on a sole tab once it has a conversation", () => {
    expect(titleTabClosable(tab({ blank: false }), 1)).toBe(true);
  });

  it("allows a blank tab to be removed when another tab remains", () => {
    expect(titleTabClosable(tab({ blank: true }), 2)).toBe(true);
  });
});

describe("titleTabContextCloseIds", () => {
  const tabs = [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" }), tab({ id: "d" })];

  it("finds every tab except the context tab", () => {
    expect(titleTabContextCloseIds(tabs, "b", "others")).toEqual(["a", "c", "d"]);
  });

  it("finds tabs on either side in visual order", () => {
    expect(titleTabContextCloseIds(tabs, "c", "left")).toEqual(["a", "b"]);
    expect(titleTabContextCloseIds(tabs, "b", "right")).toEqual(["c", "d"]);
  });

  it("returns no ids for an edge or missing tab", () => {
    expect(titleTabContextCloseIds(tabs, "a", "left")).toEqual([]);
    expect(titleTabContextCloseIds(tabs, "d", "right")).toEqual([]);
    expect(titleTabContextCloseIds(tabs, "missing", "others")).toEqual([]);
  });
});

describe("titleTabCanMoveToNewWindow", () => {
  it("disables another move while the destination is opening", () => {
    expect(titleTabCanMoveToNewWindow(tab({ movingWindow: true }))).toBe(false);
  });
  it("allows idle conversation and file tabs", () => {
    expect(titleTabCanMoveToNewWindow(tab())).toBe(true);
  });

  it("allows a busy tab, whose move is queued until the response finishes", () => {
    expect(titleTabCanMoveToNewWindow(tab({ busyHarnesses: ["claude"] }))).toBe(true);
  });

  it("keeps tabs with a terminal", () => {
    expect(titleTabCanMoveToNewWindow(tab({ hasTerminal: true }))).toBe(false);
    expect(titleTabCanMoveToNewWindow(tab({ terminal: true }))).toBe(false);
  });
});
