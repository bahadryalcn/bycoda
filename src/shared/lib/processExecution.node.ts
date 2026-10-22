import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

/** Keep the native execFile overloads/options for binary and text process owners. */
export const execFileAsync = promisify(execFile);

/** Git policy (argv, env, timeout, buffer and trimming) belongs to the caller. */
export async function runGitText(args: string[], options: ExecFileOptions): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    ...options,
    encoding: "utf8",
  });
  return stdout;
}
