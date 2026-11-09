/** Explicit opt-in installation; merely importing/running without --install changes nothing. */
import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === "--plan")) {
  console.log(
    "Opt-in plan: set repository-local core.hooksPath to scripts/setup/hooks (shared by linked worktrees). Run with --install to apply. No files are staged, formatted or tested now.",
  );
} else if (args.length === 1 && args[0] === "--install") {
  let existing = "";
  try {
    existing = execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {}
  if (existing && existing !== "scripts/setup/hooks")
    throw new Error(`Existing hooksPath is preserved (${existing}); configure the hook manually`);
  if (process.platform !== "win32") chmodSync(join(root, "scripts/setup/hooks/pre-commit"), 0o755);
  execFileSync("git", ["config", "--local", "core.hooksPath", "scripts/setup/hooks"], {
    cwd: root,
    windowsHide: true,
  });
  console.log("Enabled local staged-source checks. Other hooks/configuration were not replaced.");
} else throw new Error("Usage: node scripts/setup/git-hooks.mjs [--plan|--install]");
