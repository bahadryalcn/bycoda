import { describe, expect, it } from "vitest";
import { t } from "../../../shared/i18n";
import {
  newChangesTab,
  newCommitTab,
  newFileTab,
  newReleaseNotesWorkspaceTab,
  newSessionChangesTab,
  newTerminalFile,
} from "../model/layout";
import { releaseNotesTitle } from "../../../app/model/releaseNotes";
import { appendProblems, surfaceTabMenuItems, surfaceTabPresentation } from "./SurfaceTabs";

describe("surfaceTabPresentation", () => {
  it("labels release notes from their version", () => {
    const file = newReleaseNotesWorkspaceTab({ version: "0.1.23" }).editorPanes[0]?.files[0];
    if (!file) throw new Error("expected release-note file");

    expect(surfaceTabPresentation(t, file)).toEqual({
      name: releaseNotesTitle("0.1.23"),
      label: releaseNotesTitle("0.1.23"),
      iconName: "CHANGELOG.md",
      tooltip: releaseNotesTitle("0.1.23"),
    });
  });

  it("labels the unified working-tree tab as Changes", () => {
    expect(surfaceTabPresentation(t, newChangesTab("/repo", "/repo/App.tsx"))).toEqual({
      name: "Changes",
      label: "Changes",
      iconName: "CHANGES",
      tooltip: "Working tree changes",
    });
  });

  it("labels a session-scoped review distinctly", () => {
    expect(
      surfaceTabPresentation(t, newSessionChangesTab("/repo", "session-a", "/repo/App.tsx")),
    ).toEqual({
      name: "Session Changes",
      label: "Session Changes",
      iconName: "CHANGES",
      tooltip: "Changes captured for this session only",
    });
  });

  it("labels a commit tab from the subject", () => {
    expect(
      surfaceTabPresentation(
        t,
        newCommitTab("/repo", {
          sha: "abc1234deadbeef",
          shortSha: "abc1234",
          subject: "Fix the graph",
        }),
      ),
    ).toEqual({
      name: "Fix the graph",
      label: "Fix the graph",
      iconName: "CHANGES",
      tooltip: "abc1234 — Fix the graph",
    });
  });
});

describe("appendProblems", () => {
  it("leaves a clean file's tooltip alone", () => {
    expect(appendProblems(t, "/repo/src/app.ts", 0)).toBe("/repo/src/app.ts");
  });

  it("singularises a lone problem", () => {
    expect(appendProblems(t, "/repo/src/app.ts", 1)).toBe("/repo/src/app.ts — 1 problem");
  });

  it("pluralises the rest", () => {
    expect(appendProblems(t, "/repo/src/app.ts", 4)).toBe("/repo/src/app.ts — 4 problems");
  });
});

describe("surfaceTabMenuItems", () => {
  it("offers filesystem actions for regular and review file tabs", () => {
    for (const review of [false, true]) {
      const items = surfaceTabMenuItems(t, newFileTab("/repo/src/app.ts", "/repo", review));
      expect(items.flatMap((item) => (item.kind === "item" ? [item.label] : []))).toEqual([
        "Open in default app",
        expect.stringMatching(/Reveal|containing folder/),
        "Copy path",
        "Copy relative path",
        "Copy file name",
        "Close",
        "Close others",
        "Close tabs to the right",
        "Close tabs to the left",
      ]);
    }
  });

  it("offers close actions when a tab has no real file", () => {
    for (const file of [
      newChangesTab("/repo"),
      newCommitTab("/repo", {
        sha: "abc1234deadbeef",
        shortSha: "abc1234",
        subject: "Fix the graph",
      }),
      newSessionChangesTab("/repo", "session-a"),
      newTerminalFile("/repo"),
    ]) {
      expect(surfaceTabMenuItems(t, file)).toEqual([
        { kind: "item", id: "close", label: "Close" },
        {
          kind: "item",
          id: "close-others",
          label: "Close others",
          disabled: false,
        },
        { kind: "item", id: "close-right", label: "Close tabs to the right", disabled: true },
        { kind: "item", id: "close-left", label: "Close tabs to the left", disabled: true },
      ]);
    }
  });

  it("offers Move Left / Move Right as the menu alternative to dragging, disabled at the ends", () => {
    const moves = (sides: { left: boolean; right: boolean }) =>
      surfaceTabMenuItems(t, newFileTab("/repo/src/app.ts", "/repo"), true, undefined, sides, true)
        .filter((item) => item.kind === "item" && item.id.startsWith("move-"))
        .map((item) => (item.kind === "item" ? [item.id, item.label, item.disabled] : []));
    expect(moves({ left: false, right: true })).toEqual([
      ["move-left", "Move left", true],
      ["move-right", "Move right", false],
    ]);
    expect(moves({ left: true, right: false })).toEqual([
      ["move-left", "Move left", false],
      ["move-right", "Move right", true],
    ]);
    // Tabs without a real file get the same pair; a lone tab is offered none.
    expect(
      surfaceTabMenuItems(
        t,
        newChangesTab("/repo"),
        true,
        undefined,
        { left: true, right: true },
        true,
      )
        .filter((item) => item.kind === "item")
        .map((item) => (item.kind === "item" ? item.id : "")),
    ).toEqual(["move-left", "move-right", "close", "close-others", "close-right", "close-left"]);
    expect(
      surfaceTabMenuItems(t, newFileTab("/repo/src/app.ts", "/repo")).some(
        (item) => item.kind === "item" && item.id.startsWith("move-"),
      ),
    ).toBe(false);
  });

  it("disables Close others when there are no sibling tabs", () => {
    const items = surfaceTabMenuItems(t, newFileTab("/repo/src/app.ts", "/repo"), false);
    expect(items.find((item) => item.kind === "item" && item.id === "close-others")).toEqual({
      kind: "item",
      id: "close-others",
      label: "Close others",
      disabled: true,
    });
  });
});
