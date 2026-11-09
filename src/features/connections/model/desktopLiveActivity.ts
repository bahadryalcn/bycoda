import { noteRemoteActivity } from "../../sessions/public/remoteActivityNotice";
import { inboxOperationWrites, type DesktopInboxJob } from "../../inbox/public/remoteInbox";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import type { DesktopLiveCommand } from "./desktopLive";

const MAX_DEVICE = 80;
const MAX_CWD = 1_024;
const MAX_EVENTS = 50;
const FEED_KINDS = ["archived", "worktreeChanged", "settingsChanged"] as const;

/** Untrusted device name from the Host: a short plain string or nothing. */
function deviceName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, MAX_DEVICE);
  return name || undefined;
}

const COMMAND_KINDS = { cancel: "stopped", approve: "approved", answer: "answered" } as const;

/** A remote Stop/Approve/Answer that was actually applied here. */
export function noteCommandActivity(command: DesktopLiveCommand, cwd: string): void {
  if (command.type === "retire-writer" || !cwd) return;
  noteRemoteActivity({
    scope: { cwd },
    kind: COMMAND_KINDS[command.type],
    device: deviceName(command.requestedBy),
  });
}

/** The Host took a running conversation back for another computer. */
export function noteTakenOver(cwd: string): void {
  if (!cwd) return;
  noteRemoteActivity({ scope: { cwd }, kind: "takenOver" });
}

/** A remote inbox write finished; reads are not worth a notice. */
export function noteInboxJobActivity(job: DesktopInboxJob, ok: boolean): void {
  if (!inboxOperationWrites(job.operation)) return;
  noteRemoteActivity({
    scope: "inbox",
    kind: "inbox",
    device: deviceName(job.requestedBy),
    ok,
  });
}

export type DesktopActivityFeed = {
  seq: number;
  events: {
    kind: (typeof FEED_KINDS)[number];
    cwd: string;
    requestedBy?: string;
  }[];
  reset?: true;
};

/** Records what other devices did through the Host and remembers the cursor.
 * The first answer or a `reset` only sets the cursor: nothing is replayed. */
export function applyActivityFeed(
  feed: DesktopActivityFeed | undefined,
  beat: { activitySeq?: number },
): void {
  if (!feed || !Number.isSafeInteger(feed.seq)) return;
  const replay = feed.reset !== true && beat.activitySeq !== undefined;
  beat.activitySeq = feed.seq;
  if (!replay || !Array.isArray(feed.events)) return;
  for (const event of feed.events.slice(0, MAX_EVENTS)) {
    if (
      !event ||
      !FEED_KINDS.includes(event.kind) ||
      typeof event.cwd !== "string" ||
      !event.cwd ||
      event.cwd.length > MAX_CWD
    )
      continue;
    noteRemoteActivity({
      scope: { cwd: event.cwd },
      kind: event.kind,
      device: deviceName(event.requestedBy),
    });
    // The worktree list reloads on a refs change; no equivalent exists for the others.
    if (event.kind === "worktreeChanged") {
      try {
        notifyGitChanged(event.cwd, "refs");
      } catch {
        // No window (tests, headless): the notice above is still recorded.
      }
    }
  }
}
