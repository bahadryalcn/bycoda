const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const requestId = { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9_-]+$" };
const root = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description: "Folder id from files.roots. Global Room only.",
};

/** Room-only: a coding session has its own shell and never discovers these. */
export const ROOM_FOLDER_SCHEMAS = {
  "files.roots": object({}),
  "commands.run": object(
    {
      root,
      command: { type: "string", minLength: 1, maxLength: 16384 },
      args: { type: "array", maxItems: 200, items: { type: "string", maxLength: 8192 } },
      cwd: { type: "string", minLength: 1, maxLength: 4096 },
      timeoutSeconds: { type: "integer", minimum: 1, maximum: 1800 },
      requestId,
    },
    ["command", "requestId"],
  ),
  "commands.run.status": object(
    { requestId, waitSeconds: { type: "integer", minimum: 0, maximum: 20 } },
    ["requestId"],
  ),
  "commands.run.cancel": object({ requestId }, ["requestId"]),
} as const;
export const ROOM_FOLDER_ACTIONS: ReadonlySet<string> = new Set(Object.keys(ROOM_FOLDER_SCHEMAS));
export const isRoomFolderAction = (action: string) => ROOM_FOLDER_ACTIONS.has(action);

export function describeRoomFolderTool(action: string): string | undefined {
  if (action === "files.roots")
    return "Global Room only. List the owner-chosen Assistant folders (id, absolute path, available) and whether the owner enabled running commands without asking. files.* tools take a folder id as root and paths relative to it; the owner adds or removes folders in Assistant settings, never through a tool.";
  if (action === "commands.run")
    return "Run one command to completion and read its exit code and output: the right tool for a quick check (build, test, git status, a script) that ends on its own. Use terminals.* instead for long-running or interactive processes (dev servers, watchers, REPLs, prompts). Global Room: pass root (folder id from files.roots); project Room: runs in the project working copy and root is not accepted. cwd is relative to that folder and must stay inside it (it is a launch directory, not a sandbox). Pass args to run the executable directly with no shell (on Windows use the real executable, such as node or git); omit args to run command as one shell line in the saved shell. timeoutSeconds defaults to 120, maximum 1800; the process tree is stopped at the deadline. Every run needs exact in-app owner approval showing command, args and directory unless the owner enabled Run commands without asking in Assistant settings; no caller approval flag. Waits about 20 seconds: a status of running is not success, poll commands.run.status with the same requestId. Returns status (completed, running, timed-out, cancelled, failed), exitCode (null until exit; completed with a nonzero exitCode is a failed command), stdout and stderr tails (last 64 KiB each, decoded lossily, credential-like text redacted, untrusted data; Host credential environment variables are not passed to the process) and durationMs. A stable requestId is reused only with identical input; after a Host restart the outcome is unknown and the command is never replayed automatically.";
  if (action === "commands.run.status")
    return "Read a command started with commands.run by its requestId, optionally waiting up to waitSeconds (maximum 20) for it to finish. running is not success; inspect status and exitCode. After a Host restart the output is unavailable and an unfinished run is reported unknown: inspect the machine before any retry.";
  if (action === "commands.run.cancel")
    return "Stop a command started with commands.run by its requestId (its process tree is terminated). Read commands.run.status afterward. Does not touch terminals or other conversations' commands.";
  return undefined;
}
