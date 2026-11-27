import { pathKey, resolveWorkspacePath } from "../../../shared/lib/paths";
import { blockForStep } from "./agentStepBlocks";
import type { Block } from "./session";
import { resolveToolCallDisplay, toolCallLabel } from "./transcriptActivity";

const MAX_SESSION_TOOL_PATHS = 200;

/**
 * Files the session's tools and its subagents read, edited or wrote, newest
 * first. A listed folder ends in `/`. Bare file names in the agent's prose
 * resolve against these when the work happens outside the project folder.
 */
export function sessionToolFilePaths(blocks: readonly Block[], cwd?: string): string[] {
  const paths = new Map<string, string>();
  const add = (path: string | undefined, folder = false) => {
    const resolved = path ? resolveWorkspacePath(path, cwd) : undefined;
    if (!resolved) return;
    const key = pathKey(resolved);
    if (!paths.has(key)) paths.set(key, folder ? `${resolved.replace(/\/+$/, "")}/` : resolved);
  };
  const visit = (list: readonly Block[]) => {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (paths.size >= MAX_SESSION_TOOL_PATHS) return;
      const block = list[index];
      const steps = block.agentRun?.steps;
      if (steps?.length) visit(steps.map(blockForStep));
      const tool = block.tool;
      if (block.role !== "tool" || !tool) continue;
      for (const change of tool.fileChanges ?? []) add(change.path);
      const display = resolveToolCallDisplay(toolCallLabel(block, cwd), tool.preview, cwd);
      if (display.isFile) add(display.filePath, display.action === "List");
    }
  };
  visit(blocks);
  return [...paths.values()];
}
