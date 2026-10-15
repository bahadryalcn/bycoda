import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import {
  looksLikeProject,
  isRemoteProjectPath,
  loadRecents,
  type RecentProject,
} from "../../../features/projects/model/recents";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import {
  claudeImportTarget,
  buildImportedSession,
  type ClaudeImportTarget,
} from "../../../features/sessions/model/claudeSessionImport";
import {
  listDir,
  pickCodeWorkspaceFile,
  readTextFile,
  type ClaudeSessionSummary,
} from "../../../platform/tauri/fs";
import { message } from "@tauri-apps/plugin-dialog";
import {
  OPEN_CODE_WORKSPACE_EVENT,
  parseCodeWorkspace,
} from "../../../features/projects/model/codeWorkspace";
import {
  assignProjectsToNamedGroup,
  linkProjectGroup,
} from "../../../features/projects/model/projectGroups";
import { saveWorkspaceProjectNames } from "../../../features/workspace/model/tabGroups";
import { bindHarnessSession, stopHarnessSession } from "../../../integrations/harness";
import {
  loadSessionFolders,
  placeSessionInFolder,
  saveSessionFolders,
  type SessionFolderTarget,
} from "../../../features/sessions/model/sessionFolders";

export interface ProjectImportDeps {
  openProjects: (paths: readonly string[]) => void;
  refreshHistory: (cwd: string) => Promise<unknown>;
  sidebarCwdRef: { current: string };
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
  sessionsRef: { current: Session[] };
  turnGen: { current: Map<string, number> };
  setSessions: typeof setSessions;
}

/** Importing folders and conversations: VS Code workspaces, Claude sessions, and session folders. */
export function useProjectImport({
  openProjects,
  refreshHistory,
  sidebarCwdRef,
  setRecents,
  sessionsRef,
  turnGen,
  setSessions,
}: ProjectImportDeps) {
  /**
   * Open the folders of a VS Code workspace file as projects, collected in a
   * rail group named after the file.
   */
  const openCodeWorkspace = useCallback(async () => {
    const title = "Open VS Code workspace";
    const file = await pickCodeWorkspaceFile();
    if (!file) return;
    try {
      const workspace = parseCodeWorkspace(await readTextFile(file), file);
      const present = await Promise.all(
        workspace.folders.map((folder) =>
          listDir(folder).then(
            () => true,
            () => false,
          ),
        ),
      );
      const found = workspace.folders.filter((_, index) => present[index]);
      const skipped = [
        ...workspace.folders.filter((_, index) => !present[index]),
        ...workspace.unsupported,
      ];
      if (found.length === 0) {
        await message(
          skipped.length > 0
            ? `None of the workspace's folders could be opened:\n\n${skipped.join("\n")}`
            : "The workspace has no folders.",
          { title, kind: "error" },
        );
        return;
      }
      saveWorkspaceProjectNames(found, workspace.folderNames);
      openProjects(found);
      const group = assignProjectsToNamedGroup(workspace.name, found);
      // Folders skipped above are not listed, so they join the group later if
      // they appear on disk and are still in the file.
      if (group) linkProjectGroup(group.id, file, found);
      if (skipped.length > 0) {
        await message(
          `These folders could not be opened and were skipped:\n\n${skipped.join("\n")}`,
          { title, kind: "warning" },
        );
      }
    } catch (error) {
      await message(error instanceof Error ? error.message : String(error), {
        title,
        kind: "error",
      });
    }
  }, [openProjects]);

  useEffect(() => {
    const open = () => void openCodeWorkspace();
    window.addEventListener(OPEN_CODE_WORKSPACE_EVENT, open);
    return () => window.removeEventListener(OPEN_CODE_WORKSPACE_EVENT, open);
  }, [openCodeWorkspace]);

  const [resumePickerFor, setResumePickerFor] = useState<ClaudeImportTarget | null>(null);

  /**
   * Load a conversation Claude Code recorded into the thread the command was
   * run from, and bind it so the next turn continues that conversation rather
   * than starting a new one.
   */
  const importClaudeConversation = useCallback(
    async (target: ClaudeImportTarget, summary: ClaudeSessionSummary) => {
      // Each step below is a round trip the thread can change across, so the
      // target is rechecked at every one rather than once at the start. The
      // picker has already closed by now, so the composer is live throughout.
      const stillTarget = () =>
        claudeImportTarget(sessionsRef.current, target, turnGen.current.get(target.sessionId) ?? 0);
      if (!stillTarget()) return;
      const transcript = await readTextFile(summary.path).catch(() => null);
      if (transcript === null) return;
      if (!stillTarget()) return;

      // A child that is already running ignores the new binding: `ensureLive`
      // hands back the existing one before the resume state is read, so the
      // next turn would carry on the old conversation. Stopping it first makes
      // that turn spawn with `--resume`; the resume state itself survives.
      await stopHarnessSession("claude", target.sessionId).catch(() => undefined);
      if (!stillTarget()) return;

      setSessions((current) =>
        current.map((session) =>
          session.id === target.sessionId
            ? buildImportedSession({
                base: session,
                transcript,
                providerSessionId: summary.id,
                providerAccountId: session.providerAccountId,
              })
            : session,
        ),
      );
      bindHarnessSession(
        "claude",
        target.sessionId,
        summary.id,
        // Claude only resumes when the bound directory matches the one the
        // next turn runs in — which is the directory these conversations were
        // listed for, the checkout rather than the project root.
        target.cwd,
        target.providerAccountId,
      );
    },
    [],
  );

  const onPlaceSessionInFolder = useCallback((sessionId: string, target: SessionFolderTarget) => {
    const source = sessionsRef.current.find((session) => session.id === sessionId);
    if (!source || !looksLikeProject(source.cwd)) return;
    const folders = loadSessionFolders(source.cwd);
    if (target.kind === "existing" && !folders.some((folder) => folder.id === target.folderId)) {
      return;
    }
    saveSessionFolders(
      source.cwd,
      placeSessionInFolder(
        folders,
        isRemoteProjectPath(source.cwd) ? (remoteSessionFor(sessionId) ?? sessionId) : sessionId,
        target,
      ),
    );
  }, []);

  // Imported sessions add projects to the rail and rows to the open project.
  const onSessionsImported = useCallback(() => {
    setRecents(loadRecents());
    void refreshHistory(sidebarCwdRef.current);
  }, [refreshHistory]);

  return {
    openCodeWorkspace,
    resumePickerFor,
    setResumePickerFor,
    importClaudeConversation,
    onPlaceSessionInFolder,
    onSessionsImported,
  };
}
