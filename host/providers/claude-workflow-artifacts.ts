import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { providerAccountEnvironment } from "./provider-accounts";

const MAX_ROWS = 128;
const MAX_ENTRIES = 1024;
const MAX_TOTAL = 4 * 1024 * 1024;
const MAX_METADATA = 16 * 1024;
const MAX_TRANSCRIPT = 64 * 1024;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKFLOW = /^wf_[A-Za-z0-9_-]{1,80}$/;
const AGENT = /^agent-([A-Za-z0-9_-]{1,80})\.meta\.json$/;
const CANONICAL_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type WorkflowRequest = {
  cwd: string;
  providerAccountId?: string;
  providerSessionId: string;
  runId: string;
};
type Artifact = { agentId: string; metadata: string; transcript: string };
type ResolveRequest = {
  cwd: string;
  providerAccountId?: string;
  callId: string;
  providerSessionId?: string;
};
type WorkflowResolution = {
  providerSessionId: string;
  runId: string;
  status?: "completed" | "failed" | "stopped";
};

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function checkedPath(root: string, parts: string[]): Promise<string> {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Workflow artifact symlink rejected");
    if (!contained(root, await realpath(current)))
      throw new Error("Workflow artifact outside provider folder");
  }
  return current;
}

async function readBounded(
  root: string,
  parts: string[],
  limit: number,
  tail: boolean,
): Promise<string | undefined> {
  const path = await checkedPath(root, parts);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || (!tail && info.size > limit)) return undefined;
    // Recheck after opening so a replaced path cannot escape the account root.
    if (!contained(root, await realpath(path)))
      throw new Error("Workflow artifact outside provider folder");
    const size = Math.min(info.size, limit);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await file.read(buffer, 0, size, info.size - size);
    if (bytesRead !== size) return undefined;
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (tail && info.size > size) {
      const newline = text.indexOf("\n");
      text = newline < 0 ? "" : text.slice(newline + 1);
    }
    return text;
  } finally {
    await file.close();
  }
}

/** Read only the selected account's bounded Workflow agent artifacts. */
export async function claudeWorkflowArtifacts(request: WorkflowRequest): Promise<Artifact[]> {
  if (
    !request ||
    typeof request.cwd !== "string" ||
    !request.cwd ||
    typeof request.providerSessionId !== "string" ||
    !SESSION.test(request.providerSessionId) ||
    typeof request.runId !== "string" ||
    !WORKFLOW.test(request.runId) ||
    (request.providerAccountId !== undefined && typeof request.providerAccountId !== "string")
  )
    throw new Error("Invalid Claude Workflow artifact request");
  const cwd =
    request.cwd === "~"
      ? homedir()
      : request.cwd.startsWith(`~${sep}`)
        ? join(homedir(), request.cwd.slice(2))
        : request.cwd;
  if (!isAbsolute(cwd)) throw new Error("Invalid Claude Workflow cwd");
  const account = await providerAccountEnvironment({
    provider: "claude",
    id: request.providerAccountId,
  });
  const config =
    account?.set.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  try {
    const root = await realpath(resolve(config));
    const project = Array.from(cwd, (char) => (/[A-Za-z0-9]/.test(char) ? char : "-")).join("");
    const parts = [
      "projects",
      project,
      request.providerSessionId,
      "subagents",
      "workflows",
      request.runId,
    ];
    const dir = await checkedPath(root, parts);
    const entries = await opendir(dir);
    const names: string[] = [];
    for await (const entry of entries) {
      if (names.length >= MAX_ENTRIES) break;
      names.push(entry.name);
    }
    const result: Artifact[] = [];
    let remaining = MAX_TOTAL;
    for (const name of names.sort()) {
      const match = AGENT.exec(name);
      if (!match || result.length >= MAX_ROWS || remaining <= 0) continue;
      try {
        const metadata = await readBounded(
          root,
          [...parts, name],
          Math.min(MAX_METADATA, remaining),
          false,
        );
        if (metadata === undefined) continue;
        remaining -= Buffer.byteLength(metadata);
        const transcript = await readBounded(
          root,
          [...parts, `agent-${match[1]}.jsonl`],
          Math.min(MAX_TRANSCRIPT, remaining),
          true,
        );
        if (transcript === undefined) continue;
        remaining -= Buffer.byteLength(transcript);
        result.push({ agentId: match[1]!, metadata, transcript });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Resolve a legacy call only when a bounded scan proves one association. */
export async function resolveClaudeWorkflow(
  request: ResolveRequest,
): Promise<WorkflowResolution | null> {
  if (
    !request ||
    typeof request.cwd !== "string" ||
    !request.cwd ||
    typeof request.callId !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(request.callId) ||
    (request.providerAccountId !== undefined && typeof request.providerAccountId !== "string") ||
    (request.providerSessionId !== undefined &&
      (typeof request.providerSessionId !== "string" ||
        !CANONICAL_SESSION.test(request.providerSessionId)))
  )
    throw new Error("Invalid Claude Workflow resolver request");
  const cwd =
    request.cwd === "~"
      ? homedir()
      : request.cwd.startsWith(`~${sep}`)
        ? join(homedir(), request.cwd.slice(2))
        : request.cwd;
  if (!isAbsolute(cwd)) throw new Error("Invalid Claude Workflow cwd");
  const account = await providerAccountEnvironment({
    provider: "claude",
    id: request.providerAccountId,
  });
  const config =
    account?.set.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  try {
    const root = await realpath(resolve(config));
    const project = Array.from(cwd, (char) => (/[A-Za-z0-9]/.test(char) ? char : "-")).join("");
    const parts = ["projects", project];
    const dir = await checkedPath(root, parts);
    const names: string[] = [];
    if (request.providerSessionId) names.push(`${request.providerSessionId}.jsonl`);
    else {
      let scanned = 0;
      for await (const entry of await opendir(dir)) {
        if (++scanned > 4096) return null;
        if (!entry.name.endsWith(".jsonl") || !CANONICAL_SESSION.test(entry.name.slice(0, -6)))
          continue;
        names.push(entry.name);
        if (names.length > 256) return null;
      }
    }
    let remaining = 64 * 1024 * 1024;
    const matches: Array<WorkflowResolution & { taskId: string }> = [];
    for (const name of names) {
      const transcript = await readBounded(
        root,
        [...parts, name],
        Math.min(16 * 1024 * 1024, remaining),
        false,
      );
      if (transcript === undefined) return null;
      remaining -= Buffer.byteLength(transcript);
      let sawCall = false;
      const candidates: Array<{ taskId: string; runId: string }> = [];
      const statuses = new Map<string, Set<string>>();
      for (const line of transcript.split("\n")) {
        if (!line.trim()) continue;
        let rec: Record<string, unknown> | undefined;
        try {
          rec = object(JSON.parse(line));
        } catch {
          return null;
        }
        if (!rec) return null;
        const message = object(rec.message);
        const content = message?.content;
        if (
          rec.type === "assistant" &&
          Array.isArray(content) &&
          content.some((value) => {
            const item = object(value);
            return (
              item?.type === "tool_use" && item.name === "Workflow" && item.id === request.callId
            );
          })
        )
          sawCall = true;
        if (rec.type === "user" && sawCall && Array.isArray(content)) {
          const results = content.map(object).filter((item) => item?.type === "tool_result");
          const result = object(rec.toolUseResult) ?? object(rec.tool_use_result);
          const taskId = result?.taskId ?? result?.task_id;
          const runId = result?.runId ?? result?.run_id;
          if (
            results.length === 1 &&
            (results[0]?.tool_use_id ?? results[0]?.toolUseId) === request.callId &&
            (result?.taskType ?? result?.task_type) === "local_workflow" &&
            typeof taskId === "string" &&
            taskId &&
            typeof runId === "string" &&
            WORKFLOW.test(runId)
          )
            candidates.push({ taskId, runId });
        }
        const origin = object(rec.origin);
        if (
          rec.type === "user" &&
          origin?.kind === "task-notification" &&
          origin.producer === "session-task" &&
          typeof content === "string" &&
          /^\s*<task-notification>/.test(content)
        ) {
          const ids = [...content.matchAll(/<task-id>([^<>]+)<\/task-id>/g)];
          const states = [...content.matchAll(/<status>([^<>]+)<\/status>/g)];
          if (
            ids.length === 1 &&
            states.length === 1 &&
            /^(completed|failed|stopped)$/.test(states[0]![1]!)
          ) {
            const values = statuses.get(ids[0]![1]!) ?? new Set<string>();
            values.add(states[0]![1]!);
            statuses.set(ids[0]![1]!, values);
          }
        }
      }
      for (const candidate of candidates) {
        const states = statuses.get(candidate.taskId);
        if (states && states.size > 1) return null;
        const status = states?.values().next().value as WorkflowResolution["status"];
        matches.push({
          providerSessionId: name.slice(0, -6),
          ...candidate,
          ...(status ? { status } : {}),
        });
      }
      if (matches.length > 1) return null;
    }
    if (matches.length !== 1) return null;
    const { taskId: _taskId, ...result } = matches[0]!;
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
