import { readdir } from "node:fs/promises";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { hostGitStarts } from "./git-start-gate";

/** A project opened on a new folder starts as a repository. Only an empty folder
 * outside every work tree is initialized, so existing content and a parent
 * repository stay untouched. Opening never fails because Git could not start. */
export async function initializeEmptyProjectRepository(path: string) {
  const options = { cwd: path, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 };
  try {
    if ((await readdir(path)).length) return;
    await hostGitStarts.enter();
    const plain = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], options).then(
      () => false,
      (error: { stderr?: unknown }) => /not a git repository/i.test(String(error?.stderr ?? error)),
    );
    if (!plain) return;
    await hostGitStarts.enter();
    await execFileAsync("git", ["init", "--quiet"], options);
  } catch {
    // The folder still opens; source control offers to initialize it.
  }
}
