import { displayPath, pathKey, resolveWorkspacePath } from "../../../shared/lib/paths";
import type { Block, ToolFileChange } from "./session";
import { resolveToolCallDisplay, toolCallLabel } from "./transcriptActivity";

export type TurnChangedFile = ToolFileChange & { key: string; openPath?: string };

function legacyFileChange(block: Block, cwd?: string): ToolFileChange[] {
  const preview = block.tool?.preview;
  if (preview?.kind !== "write" || !preview.path) {
    const { action, filePath } = resolveToolCallDisplay(toolCallLabel(block, cwd), preview, cwd);
    return (action === "Edit" || action === "Write") && filePath ? [{ path: filePath }] : [];
  }
  const { path, additions, deletions, lines, contentOnly } = preview;
  if (contentOnly || (additions == null && deletions == null && !lines?.length)) return [{ path }];
  return [
    {
      path,
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
