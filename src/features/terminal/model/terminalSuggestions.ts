/** Portable command templates only. Never collect terminal input or output:
 * those streams also contain passwords, tokens and application keystrokes. */
const COMMANDS = [
  "git status",
  "git diff",
  "git diff --staged",
  "git log --oneline -10",
  "git branch",
  "git fetch",
  "git pull",
  "git stash list",
  "pnpm install",
  "pnpm dev",
  "pnpm build",
  "pnpm test",
  "pnpm lint",
  "pnpm exec ",
  "pnpm run ",
  "npm install",
  "npm run dev",
  "npm run build",
  "npm test",
  "docker ps",
  "docker compose up",
  "docker compose logs -f",
  "cargo check",
  "cargo test",
  "cargo build",
  "python --version",
  "node --version",
  "cd ",
];

export function terminalSuggestions(query: string): string[] {
  const prefix = query.trimStart().toLowerCase();
  return COMMANDS.filter((command) => command.toLowerCase().startsWith(prefix))
    .filter((command) => command !== query)
    .slice(0, 6);
}

/** Inserting into a PTY must never submit a command or inject terminal controls. */
export function isSingleLineCommand(value: string): boolean {
  // oxlint-disable-next-line no-control-regex -- PTY input must reject terminal controls and command submission.
  return !!value.trim() && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value);
}
