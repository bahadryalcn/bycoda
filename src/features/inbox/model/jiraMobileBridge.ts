import { invoke } from "@tauri-apps/api/core";
import {
  jiraProjectIdsForFetch,
  listJiraProjects,
  loadAllowedJiraBoardIds,
  loadHiddenJiraProjectIds,
} from "./jira";
import type { RemoteJiraOperation } from "./jiraBoardProtocol";

function currentPreferences() {
  return {
    allowedBoardIds: [...new Set(loadAllowedJiraBoardIds())].sort((a, b) => a - b),
    hidden: [...new Set(loadHiddenJiraProjectIds())].sort(),
  };
}
async function currentFilters() {
  const before = currentPreferences();
  const { allowedBoardIds, hidden } = before;
  const projectIds = hidden.length
    ? jiraProjectIdsForFetch(await listJiraProjects(), hidden)
    : null;
  const filters = { allowedBoardIds, projectIds: projectIds ? [...projectIds].sort() : null };
  if (JSON.stringify(before) !== JSON.stringify(currentPreferences()))
    throw new Error(
      "Desktop Jira visibility changed during the read; review the current board again",
    );
  return filters;
}
/** Desktop preferences are read here, never supplied by a paired device. */
export async function executeRemoteJiraBoard(operation: RemoteJiraOperation, deadline?: number) {
  const filters = await currentFilters();
  if (operation.action === "jira-boards") return invoke("jira_mobile_boards", { filters });
  if (operation.action === "jira-board-read") {
    if (!filters.allowedBoardIds.includes(operation.boardId))
      throw new Error("Enable this Jira board in desktop visibility settings first");
    return invoke("jira_mobile_board_read", {
      cwd: operation.cwd,
      filters,
      boardId: operation.boardId,
      scope: {
        scope: operation.scope,
        sprintId: operation.sprintId ?? null,
        pageToken: operation.pageToken ?? null,
      },
    });
  }
  const source = {
    cwd: operation.cwd,
    filters,
    snapshotId: operation.snapshotId,
    key: operation.key,
  };
  if (operation.action === "jira-issue-transitions")
    return invoke("jira_mobile_issue_transitions", source);
  if (
    !Number.isSafeInteger(deadline) ||
    Number(deadline) <= Date.now() ||
    Number(deadline) > Date.now() + 120_000
  )
    throw new Error("The native Jira approval deadline is missing or expired");
  const mutation =
    operation.action === "jira-board-transition"
      ? { action: "transition", key: operation.key, transitionId: operation.transitionId }
      : {
          action: "move",
          key: operation.key,
          target: operation.target,
          sprintId: operation.sprintId ?? null,
          beforeKey: operation.beforeKey ?? null,
          afterKey: operation.afterKey ?? null,
        };
  const prepared = await invoke<unknown>("jira_mobile_board_prepare", {
    cwd: operation.cwd,
    filters,
    snapshotId: operation.snapshotId,
    mutation,
    deadline,
  });
  if (!prepared || typeof prepared !== "object" || Array.isArray(prepared))
    throw new Error("Native Jira approval result is unconfirmed");
  const row = prepared as Record<string, unknown>;
  if (
    row.outcome === "not-submitted" &&
    typeof row.reason === "string" &&
    row.reason.length <= 1000 &&
    Object.keys(row).length === 2
  )
    return row;
  if (
    row.outcome !== "approved" ||
    typeof row.approvalId !== "string" ||
    !/^[a-f\d-]{36}$/i.test(row.approvalId) ||
    Object.keys(row).length !== 2
  )
    throw new Error("Native Jira approval result is unconfirmed");
  let freshFilters;
  try {
    freshFilters = await currentFilters();
  } catch {
    await invoke("jira_mobile_board_discard_approval", { approvalId: row.approvalId });
    return {
      outcome: "not-submitted",
      reason:
        "Desktop Jira visibility could not be verified after approval. Review the current board again.",
    };
  }
  // The phone never receives this opaque, one-use native permit. Preferences
  // are reloaded after the owner dialog and native commit compares them again.
  return invoke("jira_mobile_board_commit", { approvalId: row.approvalId, filters: freshFilters });
}
