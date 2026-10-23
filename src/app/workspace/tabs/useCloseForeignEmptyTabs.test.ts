// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  beginRemoteCreate,
  resetRemoteCreateIntentsForTests,
} from "../../../features/connections/model/remoteCreateIntent";
import { newTab } from "../../../features/workspace/model/layout";
import { newSession } from "../../../features/sessions/model/session";
import { useCloseForeignEmptyTabs, type ForeignEmptyTabsInput } from "./useCloseForeignEmptyTabs";

vi.mock("../../../features/connections/model/remoteShellState", () => ({
  remoteShellState: () => ({ bound: false, pending: false, hasDraft: false }),
}));
vi.mock("../../../features/sessions/data/composerDraftStore", () => ({
  composerDraftsLoaded: () => true,
}));
vi.mock("../../../features/sessions/model/draftCache", () => ({
  hasUnsentComposerDraft: () => false,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteCreateIntentsForTests();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("re-evaluates each remote candidate when the close is executed", async () => {
  const foreign = newSession("codex", "remote://env/other");
  const current = newSession("codex", "remote://env/current");
  const foreignTab = newTab(foreign.id);
  const currentTab = newTab(current.id);
  const onCloseTabs = vi.fn<ForeignEmptyTabsInput["onCloseTabs"]>();
  const input: ForeignEmptyTabsInput = {
    projectCwd: current.cwd,
    tabs: [currentTab, foreignTab],
    sessions: [current, foreign],
    activeTabId: currentTab.id,
    busySessionIds: new Set(),
    unseenFinishedIds: new Set(),
    dirtyFileIds: new Set(),
    movingTabIds: new Set(),
    restoredWorkspace: true,
    onCloseTabs,
  };
  function Harness() {
    useCloseForeignEmptyTabs(input);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));

  expect(onCloseTabs).toHaveBeenCalledOnce();
  const [ids, fallback, opts] = onCloseTabs.mock.calls[0];
  expect(ids).toEqual([foreignTab.id]);
  expect(fallback).toBe(currentTab.id);
  expect(opts?.stillClosable?.(foreignTab.id)).toBe(true);

  // The first turn starts creating its host session while the close confirmation waits.
  beginRemoteCreate(foreign.id, foreign.cwd, "env", []);
  expect(opts?.stillClosable?.(foreignTab.id)).toBe(false);
});
