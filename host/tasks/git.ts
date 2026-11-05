import { runGitText } from "../../src/shared/lib/processExecution.node";
import { statSync } from "node:fs";
export async function git(cwd: string, args: string[], timeout = 30000): Promise<string> {
  const stdout = await runGitText(args, {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

export function available(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
