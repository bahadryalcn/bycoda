import { useMemo, useSyncExternalStore } from "react";
import { isRemoteProvider, type HostCommand } from "./protocol";
import { RUNTIME_MODES } from "../../sessions/model/session";
import { t } from "../../../shared/i18n";

const PREFIX = "bycoda.remote-command.v1:";
const ARCHIVE_PREFIX = "bycoda.remote-command-quarantine.v1:";
const CHANGE = "bycoda:remote-outbox-change";
const pendingPrefix = (project: string, environment: string) =>
  `${PREFIX}${JSON.stringify([project, environment])}:`;
type PendingEntry = {
  v?: 1;
  savedAt?: number;
  command: HostCommand;
  shellId?: string;
  followup?: HostCommand;
  stopRequested?: boolean;
};
export type OutboxIssue = { key: string; project: string; environment: string };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): boolean =>
  object(value) && Object.values(value).every((v) => typeof v === "string");
const optionalString = (value: unknown) => value === undefined || typeof value === "string";

function validCommand(value: unknown, followup = false): value is HostCommand {
  if (!object(value) || typeof value.commandId !== "string" || !value.commandId) return false;
  if (value.type === "create") {
    return (
      typeof value.projectId === "string" &&
      !!value.projectId &&
      isRemoteProvider(value.harness) &&
      typeof value.model === "string" &&
      RUNTIME_MODES.includes(value.runtimeMode as never) &&
      (value.modelSettings === undefined || strings(value.modelSettings)) &&
      optionalString(value.worktreeCwd) &&
      optionalString(value.autoWorktreeBranch) &&
      (value.firstTurn === undefined ||
        (object(value.firstTurn) &&
          ["send", "draft"].includes(String(value.firstTurn.type)) &&
          validCommand(value.firstTurn, true)))
    );
  }
  if (
    typeof value.sessionId !== "string" ||
    (!value.sessionId && !(followup && (value.type === "send" || value.type === "draft")))
  )
    return false;
  if (value.resumeAtReset !== undefined && typeof value.resumeAtReset !== "boolean") return false;
  switch (value.type) {
    case "contextual":
      return typeof value.sourceBlockId === "string" && !!value.sourceBlockId &&
        Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0 &&
        ["handoff", "secondOpinion"].includes(String(value.mode)) && isRemoteProvider(value.harness) &&
        typeof value.model === "string" && !!value.model && strings(value.modelSettings) &&
        typeof value.previewDigest === "string" && /^[a-f0-9]{64}$/.test(value.previewDigest);
    case "configure":
      return (
        (value.harness === undefined || isRemoteProvider(value.harness)) &&
        typeof value.model === "string" &&
        strings(value.modelSettings) &&
        RUNTIME_MODES.includes(value.runtimeMode as never)
      );
    case "compact":
      return true;
    case "send":
    case "draft":
      return (
        typeof value.text === "string" &&
        (value.attachments === undefined ||
          (Array.isArray(value.attachments) &&
            value.attachments.every(
              (a) =>
                object(a) &&
                typeof a.id === "string" &&
                !!a.id &&
                typeof a.name === "string" &&
                typeof a.mimeType === "string" &&
                ["image", "audio", "file"].includes(a.kind as string) &&
                typeof a.size === "number" &&
                Number.isFinite(a.size) &&
                a.size >= 0,
            ))) &&
        (value.intent === undefined ||
          ["default", "plan", "build"].includes(value.intent as string)) &&
        optionalString(value.draftBlockId) &&
        optionalString(value.planBlockId) &&
        optionalString(value.expectedPlanText)
      );
    case "removeDraft":
      return typeof value.draftBlockId === "string" && !!value.draftBlockId;
    case "shell":
      return typeof value.line === "string";
    case "usageLimit":
      return ["arm", "disarm", "dismiss"].includes(value.action as string);
    case "steer":
      return (
        typeof value.runId === "string" &&
        !!value.runId &&
        typeof value.text === "string" &&
        validCommand({ ...value, type: "send" })
      );
    case "cancel":
      return typeof value.runId === "string" && !!value.runId;
    case "stopItem":
      return [value.runId, value.blockId, value.callId].every((entry) => typeof entry === "string" && !!entry);
    case "approve":
    case "answer": {
      if (
        typeof value.runId !== "string" ||
        !value.runId ||
        !Number.isSafeInteger(value.requestId) ||
        (value.requestId as number) < 0
      )
        return false;
      if (value.type === "approve") return value.decision === "allow" || value.decision === "deny";
      const reply = value.reply;
      return (
        object(reply) &&
        (reply.kind === "skipped" ||
          (reply.kind === "answered" &&
            object(reply.answers) &&
            Object.values(reply.answers).every(
              (a) => Array.isArray(a) && a.every((s) => typeof s === "string"),
            ) &&
            (reply.custom === undefined || strings(reply.custom))))
      );
    }
    default:
      return false;
  }
}

function readPendingEntry(value: string, id: string): PendingEntry | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!object(parsed)) return;
    const entry = "command" in parsed ? parsed : { command: parsed };
    if (entry.v !== undefined && entry.v !== 1) return;
    if (
      entry.savedAt !== undefined &&
      (typeof entry.savedAt !== "number" ||
        !Number.isFinite(entry.savedAt) ||
        entry.savedAt <= 0 ||
        Date.now() - entry.savedAt >= 6 * 24 * 60 * 60 * 1000)
    )
      return;
    if (
      !validCommand(entry.command) ||
      entry.command.commandId !== id ||
      !optionalString(entry.shellId)
    )
      return;
    if (entry.stopRequested !== undefined && typeof entry.stopRequested !== "boolean") return;
    if (
      entry.followup !== undefined &&
      (entry.command.type !== "create" ||
        !validCommand(entry.followup, true) ||
        (entry.followup.type !== "send" && entry.followup.type !== "draft"))
    )
      return;
    return entry as PendingEntry;
  } catch {
    return;
  }
}

function scopeForKey(
  key: string,
): { project: string; environment: string; id: string } | undefined {
  if (!key.startsWith(PREFIX)) return;
  // Parse the complete tuple, not a colon-delimited path: paths can contain colons.
  const start = PREFIX.length;
  for (let end = key.indexOf("]:", start); end >= 0; end = key.indexOf("]:", end + 2)) {
    try {
      const scope: unknown = JSON.parse(key.slice(start, end + 1));
      if (Array.isArray(scope) && scope.length === 2 && scope.every((s) => typeof s === "string")) {
        return {
          project: scope[0],
          environment: scope[1],
          id: key.slice(end + 2),
        };
      }
    } catch {
      /* A bracket can also occur inside a project name. */
    }
  }
}

/** Invalid entries remain in place and never become dispatchable requests. */
export function remoteOutboxIssues(project?: string, environment?: string): OutboxIssue[] {
  const issues: OutboxIssue[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const scope = scopeForKey(key);
    if (
      scope &&
      ((project !== undefined && scope.project !== project) ||
        (environment !== undefined && scope.environment !== environment))
    )
      continue;
    const value = localStorage.getItem(key);
    if (value !== null && (!scope || !readPendingEntry(value, scope.id))) {
      issues.push({
        key,
        project: scope?.project ?? "Unknown project",
        environment: scope?.environment ?? "",
      });
    }
  }
  return issues.sort((a, b) => a.key.localeCompare(b.key));
}

const EMPTY_ISSUES: OutboxIssue[] = [];
const emptyIssues = () => EMPTY_ISSUES;

export function useRemoteOutboxIssues(project?: string, environment?: string): OutboxIssue[] {
  const snapshot = useMemo(() => {
    let previous: OutboxIssue[] = [];
    return () => {
      const next = remoteOutboxIssues(project, environment);
      if (
        next.length !== previous.length ||
        next.some(
          (item, index) =>
            item.key !== previous[index].key ||
            item.project !== previous[index].project ||
            item.environment !== previous[index].environment,
        )
      )
        previous = next;
      return previous;
    };
  }, [project, environment]);
  return useSyncExternalStore(subscribeOutbox, snapshot, emptyIssues);
}

function subscribeOutbox(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}
function changed() {
  window.dispatchEvent(new Event(CHANGE));
}

/** Only called after the person checked the host; archive first, then release. */
export function archiveRemoteOutboxIssue(key: string) {
  if (!remoteOutboxIssues().some((issue) => issue.key === key))
    throw new Error("This request no longer needs recovery.");
  const value = localStorage.getItem(key);
  if (value === null) return;
  localStorage.setItem(`${ARCHIVE_PREFIX}${key}`, value);
  localStorage.removeItem(key);
  changed();
}

export function pendingRemoteFollowup(project: string, environment: string, id: string) {
  const value = localStorage.getItem(`${pendingPrefix(project, environment)}${id}`);
  return value ? readPendingEntry(value, id)?.followup : undefined;
}

/** Validated durable attachment inventory; an unreadable request is never empty. */
export function pendingRemoteAttachmentIds(
  project: string,
  environment: string,
  shellId: string,
): string[] {
  if (remoteOutboxIssues(project, environment).length)
    throw new Error("Attachment ownership is held by an unreadable pending request");
  const prefix = pendingPrefix(project, environment);
  const ids = new Set<string>();
  const collect = (command?: HostCommand) => {
    if (!command) return;
    if ("attachments" in command) for (const file of command.attachments ?? []) ids.add(file.id);
    if (command.type === "create") collect(command.firstTurn);
  };
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const entry = readPendingEntry(localStorage.getItem(key) ?? "", key.slice(prefix.length));
    if (!entry || (entry.shellId && entry.shellId !== shellId)) continue;
    collect(entry.command);
    collect(entry.followup);
  }
  return [...ids];
}

export function pendingRemoteEnvironmentAttachmentIds(environment: string): string[] {
  if (remoteOutboxIssues(undefined, environment).length)
    throw new Error("Attachment ownership is held by an unreadable pending request");
  const ids = new Set<string>();
  const collect = (command?: HostCommand) => {
    if (!command) return;
    if ("attachments" in command) for (const file of command.attachments ?? []) ids.add(file.id);
    if (command.type === "create") collect(command.firstTurn);
  };
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!;
    const scope = scopeForKey(key);
    if (!scope || scope.environment !== environment) continue;
    const entry = readPendingEntry(localStorage.getItem(key) ?? "", scope.id);
    if (!entry) throw new Error("Could not read pending attachment inventory");
    collect(entry.command);
    collect(entry.followup);
  }
  return [...ids];
}

export function pendingRemoteCommand(
  project: string,
  environment: string,
  sessionId?: string | null,
  shellId?: string,
): HostCommand | undefined {
  const prefix = pendingPrefix(project, environment);
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const value = localStorage.getItem(key);
    const entry = value ? readPendingEntry(value, key.slice(prefix.length)) : undefined;
    if (!entry) continue;
    const command = entry.command;
    if (
      sessionId === undefined ||
      (sessionId === null
        ? command.type === "create" && (!entry.shellId || entry.shellId === shellId)
        : command.type !== "create" && command.sessionId === sessionId)
    )
      return command;
  }
}

export function savePendingRemoteCommand(
  project: string,
  environment: string,
  command: HostCommand,
  shellId?: string,
  followup?: HostCommand,
) {
  if (remoteOutboxIssues(project, environment).length)
    throw new Error(
      t(
        "An unfinished request needs recovery. Check the host and review the request above before sending again.",
      ),
    );
  const entry: PendingEntry = {
    v: 1,
    savedAt:
      readPendingEntry(
        localStorage.getItem(`${pendingPrefix(project, environment)}${command.commandId}`) ?? "",
        command.commandId,
      )?.savedAt ?? Date.now(),
    command,
    shellId,
    stopRequested: remoteCommandWasStopped(project, environment, command.commandId) || undefined,
    followup: followup ?? pendingRemoteFollowup(project, environment, command.commandId),
  };
  const json = JSON.stringify(entry);
  if (json.length * 2 > 2 * 1024 * 1024)
    throw new Error(t("Remote request is too large to save safely."));
  let pendingBytes = 0;
  let pendingCount = 0;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (
      !key?.startsWith(PREFIX) ||
      key === `${pendingPrefix(project, environment)}${command.commandId}`
    )
      continue;
    pendingCount++;
    pendingBytes += (localStorage.getItem(key)?.length ?? 0) * 2;
  }
  if (pendingCount >= 100 || pendingBytes + json.length * 2 > 8 * 1024 * 1024)
    throw new Error(t("Remote outbox is full. Recover pending requests before sending more."));
  if (!readPendingEntry(json, command.commandId))
    throw new Error(t("Cannot save an invalid remote request."));
  try {
    localStorage.setItem(`${pendingPrefix(project, environment)}${command.commandId}`, json);
  } catch {
    throw new Error(t("Cannot save your request locally. Free up app storage before sending."));
  }
  changed();
}

/** Legacy entries have no retry age; a missing receipt is not proof that their
 * external effect never happened. Keep them for explicit recovery. */
export function remoteCommandNeedsVerification(
  project: string,
  environment: string,
  commandId: string,
): boolean {
  const entry = readPendingEntry(
    localStorage.getItem(`${pendingPrefix(project, environment)}${commandId}`) ?? "",
    commandId,
  );
  return !entry?.savedAt;
}
/** Persist Stop until the accepted command's exact run can be reconciled. */
export function markRemoteCommandStopped(
  project: string,
  environment: string,
  commandId: string,
): void {
  const key = `${pendingPrefix(project, environment)}${commandId}`;
  const entry = readPendingEntry(localStorage.getItem(key) ?? "", commandId);
  if (!entry) return;
  localStorage.setItem(key, JSON.stringify({ ...entry, stopRequested: true }));
  changed();
}
export function remoteCommandWasStopped(
  project: string,
  environment: string,
  commandId: string,
): boolean {
  return !!readPendingEntry(
    localStorage.getItem(`${pendingPrefix(project, environment)}${commandId}`) ?? "",
    commandId,
  )?.stopRequested;
}
export function clearPendingRemoteCommand(project: string, environment: string, commandId: string) {
  localStorage.removeItem(`${pendingPrefix(project, environment)}${commandId}`);
  changed();
}
