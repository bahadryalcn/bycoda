import type { z } from "zod";
import { ProjectsCloneParamsSchema } from "../../../src/shared/model/host-contracts/projects";
export {
  ProjectsCloneParamsSchema,
  ProjectsCloneProgressParamsSchema,
} from "../../../src/shared/model/host-contracts/projects";

/** A control character (C0 or DEL), checked by code so no regex holds control characters. */
const hasControl = (text: string) =>
  [...text].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);

export type ProjectCloneProgress = {
  state: "running" | "done" | "failed";
  phase: string;
  percent: number | null;
};

export const CLONE_DEADLINE_MS = 10 * 60_000;
const PROGRESS_TTL_MS = 10 * 60_000;

/** Same acceptance as the desktop `clone_repo`: network schemes only, never an option. */
export function validateCloneUrl(raw: string): string {
  const url = raw.trim();
  if (
    !url ||
    url.length > 2048 ||
    url.startsWith("-") ||
    /\s/.test(url) ||
    hasControl(url) ||
    !/^(https?:\/\/|ssh:\/\/|git:\/\/|git@)/i.test(url)
  )
    throw new Error("Enter an https, ssh, or git URL");
  return url;
}

/** Repository name inferred from the URL, as the desktop does. */
export function inferCloneName(url: string): string {
  const trimmed = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const name = trimmed.split(/[/:]/).pop()?.trim() ?? "";
  if (!name || name === "." || name === "..")
    throw new Error("Could not infer repository name from URL");
  return name;
}

/** One child folder name: never a path, never reserved. Mirrors createHostDirectory. */
export function validateCloneName(name: string): string {
  if (
    !name.trim() ||
    name !== name.trim() ||
    name === "." ||
    name === ".." ||
    name.startsWith("-") ||
    /[\\/<>:"|?*]/.test(name) ||
    hasControl(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
  )
    throw new Error("Invalid folder name");
  return name;
}

/** Whether a path exists; the Host injects the file system so domains stay platform-free. */
export type PathExists = (path: string) => Promise<boolean>;

/** Destination under an already-validated absolute parent; it must not exist yet. */
export async function resolveCloneDestination(
  parentPath: string,
  name: string,
  exists: PathExists,
): Promise<string> {
  // The parent is a vetted absolute directory, so joining keeps its own separator style.
  const separator = parentPath.includes("\\") && !parentPath.includes("/") ? "\\" : "/";
  const dest = `${parentPath.replace(/[\\/]+$/, "")}${separator}${validateCloneName(name)}`;
  if (await exists(dest)) throw new Error(`${dest} already exists`);
  return dest;
}

const progress = new Map<string, { value: ProjectCloneProgress; expires: number }>();
function remember(id: string | undefined, value: ProjectCloneProgress) {
  if (!id) return;
  const now = Date.now();
  for (const [key, entry] of progress) if (entry.expires < now) progress.delete(key);
  progress.set(id, { value, expires: now + PROGRESS_TTL_MS });
}
export function cloneProgress(operationId: string): ProjectCloneProgress | null {
  return progress.get(operationId)?.value ?? null;
}

const PROGRESS_LINE = /([A-Za-z][A-Za-z ]+?):\s+(\d{1,3})%/;

/** The process launch a clone needs; the Host injects `node:child_process` spawn. */
export interface CloneChild {
  stderr: {
    setEncoding(encoding: "utf8"): void;
    on(event: "data", listener: (chunk: string) => void): void;
  };
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  once(event: "close", listener: (code: number | null) => void): void;
  kill(): void;
}
export type SpawnProcess = (
  command: string,
  args: string[],
  options: { windowsHide: boolean; stdio: ["ignore", "ignore", "pipe"]; env: NodeJS.ProcessEnv },
) => CloneChild;

/** Runs `git clone -- url dest` without prompts, under a deadline, reporting progress. */
export function runGitClone(
  url: string,
  dest: string,
  options: {
    spawn: SpawnProcess;
    operationId?: string;
    deadlineMs?: number;
    gitBinary?: string;
  },
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = options.spawn(
      options.gitBinary ?? "git",
      ["clone", "--progress", "--", url, dest],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
          SSH_ASKPASS: "",
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
        },
      },
    );
    let lastLine = "";
    let buffer = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.deadlineMs ?? CLONE_DEADLINE_MS);
    child.stderr.setEncoding("utf8"); // lossy by default: invalid bytes become U+FFFD
    child.stderr.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        lastLine = line.trim();
        const match = PROGRESS_LINE.exec(line);
        if (match)
          remember(options.operationId, {
            state: "running",
            phase: match[1]!.trim(),
            percent: Math.min(100, Number(match[2])),
          });
      }
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.code === "ENOENT" ? "git is not installed" : `git clone failed: ${error.message}`,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolvePromise();
      if (timedOut) return reject(new Error("git clone timed out"));
      if (buffer.trim()) lastLine = buffer.trim();
      reject(new Error(lastLine || "git clone failed"));
    });
  });
}

/** Validates every input, then clones. `parentPath` must already be vetted by the caller. */
export async function cloneRepository(
  params: z.infer<typeof ProjectsCloneParamsSchema>,
  parentPath: string,
  run: (url: string, dest: string, options: { operationId?: string }) => Promise<void>,
  exists: PathExists,
): Promise<{ path: string }> {
  const url = validateCloneUrl(params.url);
  const dest = await resolveCloneDestination(
    parentPath,
    params.name ?? inferCloneName(url),
    exists,
  );
  remember(params.operationId, { state: "running", phase: "Starting", percent: null });
  try {
    await run(url, dest, { operationId: params.operationId });
  } catch (error) {
    remember(params.operationId, { state: "failed", phase: "Failed", percent: null });
    throw error;
  }
  remember(params.operationId, { state: "done", phase: "Done", percent: 100 });
  return { path: dest };
}
