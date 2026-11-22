import {
  execFile,
  type ExecFileOptions,
  type ExecFileOptionsWithBufferEncoding,
  type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import { promisify } from "node:util";

const nativeExecFile = promisify(execFile);
type ExecutionHints = { lane?: "default" | "background" | "control"; input?: string | Buffer };
export type ProcessExecutionOptions = ExecFileOptions & ExecutionHints;
type Output<T = string | Buffer<ArrayBuffer>> = { stdout: T; stderr: T };
type Backend = (
  file: string,
  args: readonly string[],
  options: ProcessExecutionOptions,
) => Promise<Output> | undefined;

let backend: Backend | undefined;

export function setProcessExecutionBackend(next: Backend | undefined): void {
  backend = next;
}

type Args = readonly string[] | null | undefined;
type BinaryOptions = ExecFileOptionsWithBufferEncoding & ExecutionHints;
type TextOptions = ExecFileOptionsWithStringEncoding & ExecutionHints;

export function execFileAsync(
  file: string,
  options: BinaryOptions,
): Promise<Output<Buffer<ArrayBuffer>>>;
export function execFileAsync(
  file: string,
  args: Args,
  options: BinaryOptions,
): Promise<Output<Buffer<ArrayBuffer>>>;
export function execFileAsync(file: string, options: TextOptions): Promise<Output<string>>;
export function execFileAsync(
  file: string,
  args?: Args,
  options?: TextOptions | null,
): Promise<Output<string>>;
export function execFileAsync(
  file: string,
  options: ProcessExecutionOptions | null | undefined,
): Promise<Output>;
export function execFileAsync(
  file: string,
  args: Args,
  options: ProcessExecutionOptions | null | undefined,
): Promise<Output>;
export function execFileAsync(
  file: string,
  argsOrOptions?: Args | ProcessExecutionOptions,
  options?: ProcessExecutionOptions | null,
): Promise<Output> {
  const args = Array.isArray(argsOrOptions) ? (argsOrOptions as readonly string[]) : [];
  const settings =
    (argsOrOptions && !Array.isArray(argsOrOptions)
      ? (argsOrOptions as ProcessExecutionOptions)
      : options) ?? {};
  const routed = backend?.(file, args, settings);
  if (routed) return routed;
  const child = nativeExecFile(file, args, settings);
  if (settings.input !== undefined) {
    child.child.stdin?.on("error", () => undefined);
    child.child.stdin?.end(settings.input);
  }
  return child;
}

/** Git policy (argv, env, timeout, buffer and trimming) belongs to the caller. */
export async function runGitText(args: string[], options: ExecFileOptions): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    ...options,
    encoding: "utf8",
  });
  return stdout;
}
