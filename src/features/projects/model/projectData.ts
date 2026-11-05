import { withRoomPrivacyMutation } from "../../group-lock/model/roomPrivacyProjection";
import { projectKey } from "../../../shared/lib/paths";
import { clearProjectLogo } from "./projectLogos";
import { clearProjectChatBackground } from "./chatBackground";
import {
  clearProjectChatBackgroundSetting,
  rebaseProjectChatBackgroundSetting,
} from "./projectChatBackground";
import { normalizeProjectPath } from "./recents";
import { deleteSession, listSessionsByProject } from "../../sessions/public/sessionStore";
import {
  clearTabGroupSettings,
  rebaseProjectTabGroupSettings,
} from "../../workspace/model/tabGroups";
import { rebaseProjectGroupAssignment, removeProjectGroupAssignment } from "./projectGroups";
import { rebaseAdditionalDirs, removeAdditionalDirs } from "./additionalDirs";
import { rebaseSessionFolderSettings } from "../../sessions/public/sessionFolders";
import { executeOrganizationOperation } from "../../sessions/public/sessionOrganizationOperations";
import { NATIVE_SESSION_ORGANIZATION_ACTIVE } from "../../sessions/public/sessionOrganizationStore";
import {
  clearProjectProviders,
  rebaseProjectProviders,
} from "../../sessions/public/projectProviders";
import {
  clearProjectSidebarTab,
  rebaseProjectSidebarTab,
} from "../../settings/public/projectSidebarTab";

/** Saved chats filed under this project, so the confirm prompt can count them. */
export async function projectSessionCount(path: string): Promise<number> {
  const sessions = await listSessionsByProject(path);
  return sessions.length;
}

/** Everything we persist for a project: saved chats plus its rail appearance. */
export async function removeProjectData(path: string): Promise<void> {
  const normalized = normalizeProjectPath(path);
  const key = projectKey(normalized);
  // Keep the project visible and retryable if its conversations could not be
  // read or removed. A failed read is not an empty project.
  const sessions = await listSessionsByProject(normalized);
  for (const session of sessions) {
    await deleteSession(session.id);
  }
  // Drops the copied image from app data; the localStorage entry goes with it.
  await clearProjectLogo(key).catch(() => undefined);
  await clearProjectChatBackground(key).catch(() => undefined);
  clearProjectChatBackgroundSetting(key);
  clearTabGroupSettings(key);
  await withRoomPrivacyMutation(() => removeProjectGroupAssignment(normalized));
  removeAdditionalDirs(normalized);
  clearProjectProviders(key);
  clearProjectSidebarTab(normalized);
}

/** Move local project settings after the filesystem resolver finds a rename. */
export async function rebaseProjectData(from: string, to: string): Promise<void> {
  if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
    const result = await executeOrganizationOperation(crypto.randomUUID(), {
      kind: "rebase",
      cwd: from,
      to,
    });
    if (result.state !== "applied")
      throw new Error(
        result.state === "unknown"
          ? `Folder rebase outcome is unknown: ${result.operationId}`
          : result.state === "applied-unavailable"
            ? `Folder rebase was applied, but refresh failed: ${result.operationId}`
            : "Folder rebase conflicted; refresh before retrying.",
      );
  }
  const oldKey = projectKey(normalizeProjectPath(from));
  const newKey = projectKey(normalizeProjectPath(to));
  rebaseProjectTabGroupSettings(from, to);
  rebaseProjectGroupAssignment(from, to);
  rebaseAdditionalDirs(from, to);
  rebaseProjectChatBackgroundSetting(oldKey, newKey);
  rebaseSessionFolderSettings(from, to, !NATIVE_SESSION_ORGANIZATION_ACTIVE);
  rebaseProjectProviders(oldKey, newKey);
  rebaseProjectSidebarTab(from, to);
}
