/** A checkout belongs to the selected host project; the host validates membership. */
export type TaskWorkspace = {
  checkoutCwd?: string;
  baseBranch?: string;
  /** Optional name for a single task's new isolated branch. */
  branchName?: string;
};

export const HOST_TASK_WORKSPACES = "tasks.workspaces";

export function parseTaskWorkspace(raw: unknown): TaskWorkspace | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid task workspace");
  const value = raw as Record<string, unknown>;
  const result: TaskWorkspace = {};
  for (const key of ["checkoutCwd", "baseBranch", "branchName"] as const) {
    const item = value[key];
    if (item === undefined || item === "") continue;
    if (
      typeof item !== "string" ||
      item.length > (key === "checkoutCwd" ? 4096 : 120) ||
      item.includes("\0") ||
      item.includes("\n") ||
      item.includes("\r")
    )
      throw new Error("Invalid task workspace");
    if (key !== "checkoutCwd" && (item.startsWith("-") || item.startsWith("@")))
      throw new Error("Invalid workspace branch");
    result[key] = item;
  }
  return Object.keys(result).length ? result : undefined;
}
