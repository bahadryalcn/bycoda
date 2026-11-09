import { expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { leaf, newTab, splitPane } from "../../../features/workspace/model/layout";
import { toTitleTab } from "./tabHelpers";

function session(id: string, harness: "claude" | "codex", busy = false) {
  return { ...newSession(harness, `/repo/${id}`), id, busy, title: `Chat ${id}` };
}

it("builds the title tab from every pane, focused session first", () => {
  const a = session("a", "claude");
  const b = session("b", "codex", true);
  const tab = {
    ...newTab(a.id),
    layout: splitPane(leaf(a.id), a.id, "right", b.id),
    focusedId: b.id,
  };
  const title = toTitleTab(tab, [a, b], new Set(), new Set());
  expect(title.sessionCount).toBe(2);
  expect(title.multiPane).toBe(true);
  expect(title.harnesses).toEqual(["codex", "claude"]);
  expect(title.busyHarnesses).toEqual(["codex"]);
  expect(title.more).toEqual(["Chat a"]);
  expect(title.focusedPaneId).toBe(b.id);
  expect(title.fileFocused).toBe(false);
  expect(title.blank).toBe(false);
});

it("uses the first session for a duplicated id, as find did", () => {
  const a = session("a", "claude");
  const duplicate = session("a", "codex", true);
  const tab = newTab(a.id);
  const title = toTitleTab(tab, [a, duplicate], new Set(), new Set());
  expect(title.sessionCount).toBe(1);
  expect(title.harnesses).toEqual(["claude"]);
  expect(title.busyHarnesses).toEqual([]);
});

it("falls back to the first pane session when the focused id is not a session", () => {
  const a = session("a", "claude");
  const b = session("b", "codex");
  const tab = {
    ...newTab(a.id),
    layout: splitPane(leaf(a.id), a.id, "right", b.id),
    focusedId: "missing",
  };
  const title = toTitleTab(tab, [a, b], new Set(), new Set());
  expect(title.harnesses).toEqual(["claude", "codex"]);
  expect(title.more).toEqual(["Chat b"]);
});
