import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runs the local-update Python fixtures with whichever interpreter exists:
// Windows normally has `python`; Linux/macOS commonly have only `python3`.
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = [
  "-B",
  "-m",
  "unittest",
  "discover",
  "-s",
  "scripts/local-update",
  "-p",
  "test_local_update.py",
  ...process.argv.slice(2),
];
const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
for (const command of candidates) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error?.code === "ENOENT") continue;
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
console.error("Python 3 is required (tried: " + candidates.join(", ") + ").");
process.exit(1);
