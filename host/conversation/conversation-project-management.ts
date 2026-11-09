import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { hostGitStarts } from "../git/git-start-gate";
import { existingPath, hostGitIndex, workspacePath } from "../workspaces/workspace";
import { relative, sep } from "node:path";
import { lstat } from "node:fs/promises";
import { scrubRuntimeLogText } from "../execution/runtime-logs";
const text = { type: "string", minLength: 1, maxLength: 4096 };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const write = {
  requestId: text,
  expectedStatus: { type: "string", pattern: "^[a-f0-9]{64}$" },
};
const page = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};
const organizationPage = {
  ...page,
  memberOffset: {
    type: "integer",
    minimum: 0,
    description:
      "Offset for sessionIds within each returned folder. Keep the parent offset when following membership pagination.",
  },
};
export const PROJECT_MANAGEMENT_TOOLS = {
  "projects.organization.read": object(organizationPage),
  "projects.organization.status": object(
    {
      requestId: text,
      originalInput: {
        type: "object",
        description:
          "For a Room workspace transfer, the exact original patch input; status never replays it.",
      },
      ...organizationPage,
    },
    ["requestId"],
  ),
  "projects.organization.patch": object(
    {
      requestId: text,
      expectedRevision: { type: "string", pattern: "^[a-f0-9]{64}$" },
      change: {
        type: "object",
        description:
          "One existing desktop organization change. Kinds: projectName(name), projectGroup(groupId or null), projectMove(step), groupName(name), groupMove(step), folderCreate(name,sessionIds,parentId), folderName(folderId,name), folderMove(folderId,target), folderOrder(folderIds), sessionMove(sessionId,folderId or null), folderSessions(folderId,sessionIds), sessionOrder(list:loose|pinned,sessionIds). Read the current snapshot first; IDs must be visible in the current project. The desktop validates every field and rejects stale revisions.",
      },
    },
    ["requestId", "expectedRevision", "change"],
  ),
  "projects.browse": object({
    path: text,
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  "projects.createDirectory": object(
    {
      requestId: text,
      path: text,
      name: { type: "string", minLength: 1, maxLength: 200 },
    },
    ["requestId", "path", "name"],
  ),
  "projects.open": object({ requestId: text, path: text }, ["requestId", "path"]),
  "git.stash": object(
    {
      ...write,
      paths: { type: "array", minItems: 1, maxItems: 100, items: text },
      message: { type: "string", maxLength: 1000 },
    },
    ["requestId", "expectedStatus", "paths"],
  ),
  "git.pull": object(write, ["requestId", "expectedStatus"]),
} as const;
export const PROJECT_MANAGEMENT_READS = new Set<string>([
  "projects.browse",
  "projects.organization.read",
  "projects.organization.status",
]);
export type ProjectManagementAction = keyof typeof PROJECT_MANAGEMENT_TOOLS;
export const isProjectManagementAction = (action: string): action is ProjectManagementAction =>
  Object.hasOwn(PROJECT_MANAGEMENT_TOOLS, action);
/** Scope is the already unlocked project root. Symlinks cannot escape it. */
export async function projectManagementPath(root: string, path: unknown = ".") {
  const checked = workspacePath(root, path, true);
  if (!relative(root, checked)) return checked;
  return existingPath(root, relative(root, checked));
}
/** Called only inside HostGitService.managedAction after exact status approval.
 * No raw command, credential, remote URL, destructive reset or stash-all API. */
export async function runConversationGitAction(
  cwd: string,
  action: "git.stash" | "git.pull",
  input: Record<string, unknown>,
) {
  let args: string[];
  if (action === "git.pull") {
    if ((await hostGitIndex(cwd)).files.length)
      throw new Error("Pull requires a clean working tree and index.");
    args = ["pull", "--ff-only"];
  } else {
    if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 100)
      throw new Error("Choose explicit files to stash.");
    const paths: string[] = [];
    for (const value of input.paths) {
      const path = workspacePath(cwd, value);
      const relativePath = relative(cwd, path).split(sep).join("/");
      const current = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
        throw error;
      });
      // Deleted tracked paths are valid; existing files still get canonical containment.
      if (current) {
        await existingPath(cwd, relative(cwd, path));
        if (!current.isFile()) throw new Error("Stash accepts explicit regular files only.");
      } else {
        // A missing directory is still a recursive Git pathspec. Accept only an
        // exact normal file in the index, never a directory prefix or submodule.
        await hostGitStarts.enter();
        const tracked = await execFileAsync(
          "git",
          ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", relativePath],
          { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
        );
        const rows = tracked.stdout.split("\0").filter(Boolean);
        if (
          rows.length !== 1 ||
          !/^100(?:644|755) [a-f0-9]+ 0\t/.test(rows[0]) ||
          rows[0].slice(rows[0].indexOf("\t") + 1) !== relativePath
        )
          throw new Error("Stash accepts explicit regular files only.");
      }
      paths.push(relativePath);
    }
    if (
      input.message !== undefined &&
      (typeof input.message !== "string" ||
        input.message.length > 1000 ||
        input.message.includes("\0"))
    )
      throw new Error("Invalid stash message.");
    args = [
      "--literal-pathspecs",
      "stash",
      "push",
      "--include-untracked",
      "-m",
      String(input.message ?? "bycoda approved stash"),
      "--",
      ...paths,
    ];
  }
  await hostGitStarts.enter();
  const result = await execFileAsync("git", ["-c", "core.pager=cat", ...args], {
    cwd,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  return { output: scrubRuntimeLogText(result.stdout, 8000) };
}
