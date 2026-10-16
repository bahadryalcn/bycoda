// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  newEditorWorkspaceTab,
  newFileTab,
  newTab,
} from "../../../features/workspace/model/layout";
import { useActiveWorkspaceContext } from "./useActiveWorkspaceContext";
import { useWorktreeDeckTabs } from "../layout/useWorktreeDeckTabs";
import { toTitleTab } from "../helpers/tabHelpers";

describe("standalone document workspace context", () => {
  it.each(["/repo", "remote://mac/Users/owner/repo"])(
    "keeps the selected project %s and its tabs while inspecting an external file",
    async (projectCwd) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const documentTab = newEditorWorkspaceTab({
        ...newFileTab("/Downloads/report.pdf", "/Downloads"),
        external: true,
      });
      const projectTab = newEditorWorkspaceTab(newFileTab(`${projectCwd}/readme.md`, projectCwd));
      const otherProject = newEditorWorkspaceTab(newFileTab("/other/readme.md", "/other"));
      const blank = newTab("empty-chat");
      const tabs = [projectTab, documentTab, otherProject, blank];
      const title = toTitleTab(documentTab, [], new Set(), new Set());
      expect(title.project).toBe("~");
      expect(title.files).toEqual(["report.pdf"]);
      function Harness({ activeTabId }: { activeTabId: string }) {
        const context = useActiveWorkspaceContext({
          tabs,
          activeTabId,
          sessions: [],
          projectCwd,
          historyErrorCwd: null,
          loadedProjects: new Set([projectCwd]),
        });
        expect(context.sidebarCwd).toBe(projectCwd);
        expect(context.gitCwd).toBe(projectCwd);
        expect(context.filesCwd).toBe(projectCwd);
        expect(context.terminalCwd).toBe(projectCwd);
        const deck = useWorktreeDeckTabs({
          tabs,
          sessions: [],
          sidebarCwd: context.sidebarCwd,
          projectCwd,
          activeTabId,
          projectWorktree: null,
          tabWorkspace: (tab) => (tab === documentTab ? null : projectCwd),
          workspaceNavigation: { revision: 0 },
        });
        expect(deck.deckProjectTabs.map((tab) => tab.id)).toEqual([projectTab.id, documentTab.id]);
        return null;
      }
      try {
        await act(async () => root.render(createElement(Harness, { activeTabId: documentTab.id })));
        await act(async () => root.render(createElement(Harness, { activeTabId: projectTab.id })));
      } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
      }
    },
  );
});
