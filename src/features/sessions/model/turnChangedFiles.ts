import { displayPath, pathKey, resolveWorkspacePath } from "../../../shared/lib/paths";
import type { Block, ToolFileChange } from "./session";
import { resolveToolCallDisplay, toolCallLabel } from "./transcriptActivity";

export type TurnChangedFile = ToolFileChange & { key: string; openPath?: string };

/**
 * Claude's Write reports which it did in its result: "File created successfully at: …" for a new
 * file, "The file … has been updated successfully." for an existing one.
 * shortcut: reads Claude Code's result wording; carry the result's `type` ("create" | "update")
 * from the adapter if that wording changes.
 */
function writeStatus(block: Block): ToolFileChange["status"] {
  const detail = block.tool?.detail?.trimStart() ?? "";
  if (/^File created successfully at:/i.test(detail)) return "added";
  if (/^The file .+ has been updated successfully/i.test(detail)) return "modified";
  return undefined;
}

function legacyFileChange(block: Block, cwd?: string): ToolFileChange[] {
  const preview = block.tool?.preview;
  const status = writeStatus(block);
  const marked = status ? { status } : {};
  if (preview?.kind !== "write" || !preview.path) {
    const { action, filePath } = resolveToolCallDisplay(toolCallLabel(block, cwd), preview, cwd);
    return (action === "Edit" || action === "Write") && filePath
      ? [{ path: filePath, ...marked }]
      : [];
  }
  const { path, additions, deletions, lines, contentOnly } = preview;
  if (contentOnly || (additions == null && deletions == null && !lines?.length))
    return [{ path, ...marked }];
  return [
    {
      path,
      ...marked,
      counts: {
        additions: additions ?? lines?.filter((line) => line.kind === "add").length ?? 0,
        deletions: deletions ?? lines?.filter((line) => line.kind === "del").length ?? 0,
      },
    },
  ];
}

/** Add recorded edit counts within a single transcript turn, in first-edit order. */
export function turnChangedFiles(turn: readonly Block[], cwd?: string): TurnChangedFile[] {
  const files = new Map<string, TurnChangedFile>();
  for (const block of turn) {
    const tool = block.tool;
    if (
      block.role !== "tool" ||
      block.approval?.decided === "deny" ||
      (tool?.status !== "completed" && tool?.status !== "success")
    ) {
      continue;
    }
    for (const change of tool.fileChanges ?? legacyFileChange(block, cwd)) {
      const openPath = resolveWorkspacePath(change.path, cwd);
      const key = pathKey(openPath ?? change.path);
      const previous = files.get(key);
      if (!previous) {
        files.set(key, {
          ...change,
          key,
          path: displayPath(openPath ?? change.path, cwd),
          openPath,
        });
      } else {
        // A file added earlier in the turn stays added when edited again.
        if (change.status && !(previous.status === "added" && change.status === "modified")) {
          previous.status = change.status;
        }
        const before = previous.counts;
        const next = change.counts;
        previous.counts =
          before && next
            ? {
                additions: before.additions + next.additions,
                deletions: before.deletions + next.deletions,
              }
            : undefined;
      }
    }
  }
  return [...files.values()];
}
