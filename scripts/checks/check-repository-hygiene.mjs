import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Ignore rules do not affect files already tracked by Git. Check the index so
// accidental `git add -f` cannot silently publish local artifacts or key files.
const root = fileURLToPath(new URL("../../", import.meta.url));
const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8", windowsHide: true },
)
  .split("\0")
  .filter(Boolean);

if (paths.length) {
  console.error("Ignored files are still tracked by Git:");
  for (const path of paths) console.error(`  ${path}`);
  console.error("Review them and untrack local artifacts with git rm --cached.");
  process.exitCode = 1;
} else {
  console.log("Repository hygiene passed: no ignored files are tracked.");
}
