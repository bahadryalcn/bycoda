import { fileURLToPath } from "node:url";
import { setProcessExecutionBackend } from "../../src/shared/lib/processExecution.node";
import { hostGitExec, type GitExecPool } from "./git-exec-pool";

const supportedOptions = new Set([
  "cwd",
  "env",
  "timeout",
  "maxBuffer",
  "encoding",
  "windowsHide",
  "input",
  "signal",
  "lane",
  "shell",
  "killSignal",
  "windowsVerbatimArguments",
]);

/** Register for the serving Host lifetime. Dispose before closing the workers. */
export function registerHostProcessExecution(pool: GitExecPool = hostGitExec): () => void {
  setProcessExecutionBackend((file, args, options) => {
    if (
      Object.keys(options).some((key) => !supportedOptions.has(key)) ||
      (options.shell !== undefined && options.shell !== false) ||
      options.windowsVerbatimArguments ||
      (options.killSignal !== undefined && options.killSignal !== "SIGTERM")
    )
      return undefined;

    const { cwd, env, timeout = 0, maxBuffer, windowsHide = false, input, signal, lane } = options;
    const encoding = options.encoding === undefined ? "utf8" : options.encoding;
    return pool.exec(file, args, {
      cwd: cwd === undefined || typeof cwd === "string" ? cwd : fileURLToPath(cwd),
      env,
      replaceEnv: true,
      timeout,
      nativeTimeout: true,
      maxBuffer,
      encoding: encoding && Buffer.isEncoding(encoding) ? encoding : "buffer",
      windowsHide,
      input,
      signal,
      lane,
    });
  });
  return () => setProcessExecutionBackend(undefined);
}
