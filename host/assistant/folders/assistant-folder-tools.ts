import { createHash } from "node:crypto";
import { registerRoomCommandHandle } from "../../automations/room-command-lifetime";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { monotonicNow } from "../../../src/shared/lib/time/timestamps";
import type { AssistantFoldersResponse } from "../../../src/shared/model/assistantFolders";
import { callFileConversationTool } from "../../conversation/conversation-file-tools";
import {
  ConversationManagementTools,
  managementReceiptKey,
  type GlobalManagementPrincipal,
  type ManagementPorts,
  type ManagementReceipt,
} from "../../conversation/conversation-management-tools";
import { validateConversationTool } from "../../conversation/conversation-tools";
import { scrubRuntimeLogText } from "../../execution/runtime-logs";
import { existingPath } from "../../workspaces/workspace";
import type { AssistantThreadPrincipal } from "../../sessions/session-authority";
import { roomOperationInput } from "../room/assistant-room-operation-input";
import { assertAssistantPathAllowed, resolveAssistantFolder } from "./assistant-folders";
import { folderWorkspaceRun } from "./assistant-folder-mutations";
import {
  COMMAND_DEFAULT_TIMEOUT_SECONDS,
  startCommand,
  type CommandSnapshot,
  type RunningCommand,
} from "./assistant-command-process";
import { ROOM_FOLDER_ACTIONS, isRoomFolderAction } from "./assistant-folder-schemas";

export { isRoomFolderAction };
export type FolderProjectPrincipal = AssistantThreadPrincipal & { projectCwd: string };
export type FolderPrincipal = FolderProjectPrincipal | GlobalManagementPrincipal;
type Qualify = <T>(effect: () => Promise<T>) => Promise<T>;
type FolderState = Pick<
  AssistantFoldersResponse,
  "folders" | "runWithoutAsking" | "allowChangesWithoutAsking"
>;

export type FolderToolPorts = Pick<
  ManagementPorts<string, FolderPrincipal>,
  "approve" | "receipt" | "saveReceipt"
> & {
  folders(): Promise<FolderState>;
  /** Test seam; defaults to the real process runner. */
  start?: typeof startCommand;
  /** How long `commands.run` waits before answering "running". Default 20 s. */
  inlineWaitMs?: number;
};

const FILE_WRITES = new Set([
  "files.create",
  "files.write",
  "files.rename",
  "files.move",
  "files.copy",
  "files.delete",
]);
const FILE_READS = new Set([
  "files.inspect",
  "files.list",
  "files.index",
  "files.search",
  "files.searchContent",
  "files.read",
]);
const MAX_RUNNING = 8;
const LEDGER_TTL_MS = 60 * 60 * 1000;
const LEDGER_MAX = 200;
const fileStatus = z.strictObject({
  operationId: z.string().min(1).max(200),
  action: z.enum([...FILE_WRITES] as [string, ...string[]]),
  originalInput: z.record(z.string(), z.unknown()),
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isProject = (p: FolderPrincipal): p is FolderProjectPrincipal =>
  "projectCwd" in p && typeof p.projectCwd === "string";

type Entry = {
  signature: string;
  handle: RunningCommand;
  settledAt?: number;
};

/** A chosen folder may be a whole drive or the home folder; system and credential folders inside
 * it stay closed to every file tool, including a create or rename that would land in one. */
async function guardFolderPaths(root: string, action: string, input: Record<string, unknown>) {
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const path = text(input.path);
  const parent = text(input.parent);
  const name = text(input.name);
  const paths = [path, parent, text(input.destinationParent)].filter(
    (value) => value !== undefined,
  );
  if (name !== undefined) paths.push(join(parent ?? dirname(path ?? "."), name));
  if (action === "files.list" && paths.length === 0) paths.push(".");
  for (const value of paths) await assertAssistantPathAllowed(resolve(root, value));
}

/** Drops content previews found in system or credential folders. shortcut: totals are counted
 * before filtering; filter inside the search if exact totals are ever needed. */
async function withoutProtectedMatches(root: string, result: unknown) {
  const page = result as { items: { path: string }[] };
  const items = [];
  for (const item of page.items) {
    const allowed = await assertAssistantPathAllowed(resolve(root, item.path)).then(
      () => true,
      () => false,
    );
    if (allowed) items.push(item);
  }
  return { ...page, items };
}

/** The final, output-free part of a run, kept in the durable receipt. */
const summary = (snapshot: CommandSnapshot) => ({
  status: snapshot.status,
  exitCode: snapshot.exitCode,
  durationMs: snapshot.durationMs,
  ...(snapshot.error ? { error: snapshot.error } : {}),
});

/** Global Room file tools over owner-chosen folders, and `commands.run` for the global Room and
 * project Room threads. Reads need no approval; writes and runs use their explicit owner grants
 * or request exact native approval. Legacy command grants never grant file changes. Unknown outcomes are
 * reported, never retried. */
export function createAssistantFolderTools(ports: FolderToolPorts) {
  const ledger = new Map<string, Entry>();
  const inlineWaitMs = ports.inlineWaitMs ?? 20_000;
  const start = ports.start ?? startCommand;

  const prune = () => {
    const now = monotonicNow();
    for (const [key, entry] of ledger)
      if (entry.settledAt !== undefined && now - entry.settledAt > LEDGER_TTL_MS)
        ledger.delete(key);
    for (const [key, entry] of ledger) {
      if (ledger.size <= LEDGER_MAX) break;
      if (entry.settledAt !== undefined) ledger.delete(key);
    }
  };
  const base = async (principal: FolderPrincipal, root: unknown) => {
    if (isProject(principal)) {
      if (root !== undefined)
        throw new Error(
          "root selects an Assistant folder and is only available in the global Room.",
        );
      if (!isAbsolute(principal.projectCwd)) throw new Error("Room project target is invalid.");
      return { path: principal.projectCwd };
    }
    return { path: await resolveAssistantFolder(await ports.folders(), root), root: String(root) };
  };
  /** The same key the management receipt uses, so a run has exactly one durable receipt. */
  const runKey = (principal: FolderPrincipal, requestId: string) =>
    managementReceiptKey(principal, requestId);

  const requireRequestId = (value: unknown) => {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
      throw new Error("A stable requestId is required.");
    return value;
  };

  /** Files: the existing implementations, rooted at the folder instead of a project cwd. */
  const fileTools = new ConversationManagementTools<string, FolderPrincipal>(
    {
      receipt: ports.receipt,
      saveReceipt: ports.saveReceipt,
      approve: async (operation, principal, authorized) =>
        (await ports.folders()).allowChangesWithoutAsking === true
          ? { approved: true, operationHash: operation.operationHash }
          : ports.approve(operation, principal, authorized),
      execute: async (action, args, principal, authorized) => {
        const { requestId: _requestId, root, rootPath, ...input } = args;
        const path = (await base(principal, root)).path;
        if (path !== rootPath) throw new Error("The Assistant folder changed during review.");
        validateConversationTool(action, input);
        if (root !== undefined) await guardFolderPaths(path, action, input);
        const result = await callFileConversationTool(
          path,
          action,
          input,
          folderWorkspaceRun(path, authorized),
          authorized,
        );
        if (!(await authorized()))
          throw new Error("Assistant folder authority revoked; inspect the original operation.");
        return result;
      },
    },
    FILE_READS,
  );

  const commandTools = new ConversationManagementTools<string, FolderPrincipal>(
    {
      receipt: ports.receipt,
      saveReceipt: ports.saveReceipt,
      approve: async (operation, principal, authorized) =>
        (await ports.folders()).runWithoutAsking
          ? { approved: true, operationHash: operation.operationHash }
          : ports.approve(operation, principal, authorized),
      execute: async (_action, args, principal, authorized) => {
        const { requestId, root, rootPath, projectPath, resolvedCwd, mode, command, ...rest } =
          args as Record<string, unknown> & { requestId: string; command: string };
        const target = await base(principal, root);
        if (target.path !== (rootPath ?? projectPath))
          throw new Error("The command target changed during review.");
        const cwd = await existingPath(target.path, rest.cwd ?? ".", true);
        if (cwd !== resolvedCwd || !(await stat(cwd)).isDirectory())
          throw new Error("The command working directory changed during review.");
        if (root !== undefined) await assertAssistantPathAllowed(cwd);
        if (ledger.size >= LEDGER_MAX) prune();
        if (
          [...ledger.values()].filter((entry) => entry.settledAt === undefined).length >=
          MAX_RUNNING
        )
          throw new Error("Too many Assistant commands are running; wait for one or cancel it.");
        if (!(await authorized())) throw new Error("Assistant command authority revoked.");
        const handle = start({
          command,
          ...(mode === "direct" ? { args: rest.args as string[] } : {}),
          cwd,
          timeoutMs: Number(rest.timeoutSeconds) * 1000,
        });
        const roomOwned = registerRoomCommandHandle(handle);
        const key = runKey(principal, requestId);
        const entry: Entry = { signature: sha(["commands.run", args]), handle };
        ledger.set(key, entry);
        handle.done
          .then(async (snapshot) => {
            entry.settledAt = monotonicNow();
            await ports.saveReceipt(key, {
              signature: entry.signature,
              state: "completed",
              result: summary(snapshot),
            });
          })
          .catch((error) => console.error("Assistant command receipt failed:", error));
        // Automation parent retains the original process and native source permit through retirement.
        if (roomOwned) await handle.done;
        else await Promise.race([handle.done, sleep(inlineWaitMs)]);
        if (!(await authorized())) {
          handle.cancel();
          await handle.done;
          throw new Error("Assistant command authority revoked; inspect the original request.");
        }
        return summary(handle.snapshot());
      },
    },
    new Set(),
  );

  /** Output is a bounded tail; a missing ledger entry means the outcome is not observable. */
  const view = (requestId: string, snapshot: CommandSnapshot, extra: object = {}) => ({
    requestId,
    ...snapshot,
    stdout: scrubRuntimeLogText(snapshot.stdout, Number.MAX_SAFE_INTEGER),
    stderr: scrubRuntimeLogText(snapshot.stderr, Number.MAX_SAFE_INTEGER),
    ...extra,
  });
  const afterRestart = (requestId: string, receipt: ManagementReceipt | undefined) => {
    if (!receipt) return { requestId, status: "unknown" as const, outcomeUnknown: true };
    const result = receipt.result as { status?: string } | undefined;
    const final = result && result.status !== "running";
    return {
      requestId,
      ...(final ? (result as object) : { status: "unknown" as const }),
      outcomeUnknown: !final,
      outputUnavailable: true,
      note: "The Host no longer holds this run; never replay it automatically.",
    };
  };

  async function runCommand(
    input: Record<string, unknown>,
    principal: FolderPrincipal,
    authorized: () => Promise<boolean>,
    qualify: Qualify,
  ) {
    const requestId = requireRequestId(input.requestId);
    validateConversationTool("commands.run", input);
    const target = await base(principal, input.root);
    const cwd = await existingPath(target.path, input.cwd ?? ".", true);
    if (!(await stat(cwd)).isDirectory()) throw new Error("cwd must be a directory.");
    const direct = Array.isArray(input.args);
    // The exact operation the owner sees and the receipt hashes: nothing implicit remains.
    const operation = roomOperationInput(
      {
        ...(isProject(principal)
          ? { projectPath: target.path }
          : { root: input.root, rootPath: target.path }),
        command: input.command,
        ...(direct ? { args: input.args } : {}),
        cwd: input.cwd ?? ".",
        resolvedCwd: cwd,
        mode: direct ? "direct" : "shell",
        timeoutSeconds: input.timeoutSeconds ?? COMMAND_DEFAULT_TIMEOUT_SECONDS,
      },
      requestId,
    );
    prune();
    const key = runKey(principal, requestId);
    const live = ledger.get(key);
    if (live) {
      if (live.signature !== sha(["commands.run", operation]))
        throw new Error("Management request ID was reused with different input.");
      return qualify(async () => {
        await Promise.race([live.handle.done, sleep(inlineWaitMs)]);
        return view(requestId, live.handle.snapshot());
      });
    }
    const result = (await commandTools.call(
      "commands.run",
      operation,
      principal,
      authorized,
      qualify,
    )) as { requestId: string; state: string; error?: string; result?: unknown };
    if (result.state === "completed" && ledger.has(key))
      return view(requestId, ledger.get(key)!.handle.snapshot());
    if (result.state === "completed")
      return afterRestart(requestId, { state: "completed", signature: "", result: result.result });
    return { requestId, state: result.state, ...(result.error ? { error: result.error } : {}) };
  }

  async function runStatus(
    input: Record<string, unknown>,
    principal: FolderPrincipal,
    authorized: () => Promise<boolean>,
    cancel: boolean,
  ) {
    const requestId = requireRequestId(input.requestId);
    if (!(await authorized())) throw new Error("Assistant command authority revoked.");
    const key = runKey(principal, requestId);
    const entry = ledger.get(key);
    if (!entry) return afterRestart(requestId, await ports.receipt(key));
    if (cancel) {
      entry.handle.cancel();
      await entry.handle.done;
    } else if (Number(input.waitSeconds) > 0)
      await Promise.race([
        entry.handle.done,
        sleep(Math.min(Number(input.waitSeconds), 20) * 1000),
      ]);
    if (!(await authorized())) throw new Error("Assistant command authority revoked.");
    return view(requestId, entry.handle.snapshot(), cancel ? { cancelRequested: true } : {});
  }

  async function files(
    action: string,
    input: Record<string, unknown>,
    principal: FolderPrincipal,
    authorized: () => Promise<boolean>,
  ) {
    if (isProject(principal)) throw new Error("Project Room files use their own project tools.");
    const { root, requestId, ...original } = input;
    if (action === "files.operation.status") {
      const query = fileStatus.parse(input);
      const { root: queryRoot, ...inner } = query.originalInput;
      if (Object.hasOwn(inner, "requestId"))
        throw new Error("Original file input must not contain requestId.");
      validateConversationTool(query.action, inner);
      const path = (await base(principal, queryRoot)).path;
      const signature = sha([
        query.action,
        roomOperationInput({ ...inner, root: queryRoot, rootPath: path }, query.operationId),
      ]);
      if (!(await authorized())) throw new Error("Assistant folder authority revoked.");
      const receipt = await ports.receipt(managementReceiptKey(principal, query.operationId));
      if (!receipt) return { operationId: query.operationId, state: "unknown" };
      if (receipt.signature !== signature)
        throw new Error("Original file operation identity changed.");
      return {
        operationId: query.operationId,
        ...receipt,
        state: receipt.state === "pending" ? "uncertain" : receipt.state,
      };
    }
    const path = (await base(principal, root)).path;
    validateConversationTool(action, original);
    await guardFolderPaths(path, action, original);
    if (FILE_READS.has(action)) {
      if (!(await authorized())) throw new Error("Assistant folder authority revoked.");
      const result = await callFileConversationTool(path, action, original);
      if (!(await authorized())) throw new Error("Assistant folder authority revoked.");
      return action === "files.searchContent"
        ? await withoutProtectedMatches(path, result)
        : result;
    }
    if (!FILE_WRITES.has(action)) throw new Error("Unsupported Assistant folder file tool.");
    const id = requireRequestId(requestId);
    return fileTools.call(
      action,
      roomOperationInput({ ...original, root, rootPath: path }, id),
      principal,
      authorized,
    );
  }

  return {
    /** Callers inject `requestId` for writes and runs; discovery and reads need none. */
    async call(
      action: string,
      input: Record<string, unknown>,
      principal: FolderPrincipal,
      authorized: () => Promise<boolean>,
      qualify: Qualify = (effect) => effect(),
    ) {
      if (!ROOM_FOLDER_ACTIONS.has(action) && !isFileAction(action))
        throw new Error("Unsupported Assistant folder tool.");
      if (!(await authorized())) throw new Error("Assistant folder authority revoked.");
      if (action === "files.roots") {
        if (isProject(principal))
          throw new Error("files.roots is only available in the global Room.");
        const state = await ports.folders();
        return {
          roots: await Promise.all(
            state.folders.map(async (folder) => ({
              id: folder.id,
              path: folder.path,
              available: await resolveAssistantFolder(state, folder.id).then(
                () => true,
                () => false,
              ),
            })),
          ),
          runWithoutAsking: state.runWithoutAsking,
        };
      }
      // A project target must be held and captured by the caller's scope at least once.
      let qualified = false;
      const held: Qualify = (effect) => {
        qualified = true;
        return qualify(effect);
      };
      const result =
        action === "commands.run"
          ? await runCommand(input, principal, authorized, held)
          : action === "commands.run.status" || action === "commands.run.cancel"
            ? await held(() => runStatus(input, principal, authorized, action.endsWith("cancel")))
            : await files(action, input, principal, authorized);
      if (isProject(principal) && !qualified) await qualify(async () => undefined);
      return result;
    },
  };
}
const isFileAction = (action: string) =>
  FILE_READS.has(action) || FILE_WRITES.has(action) || action === "files.operation.status";
export const isGlobalFolderFileAction = isFileAction;
export const isGlobalFolderFileWrite = (action: string) => FILE_WRITES.has(action);
