import type { Block, Session, RuntimeMode } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import type { AgentModel } from "../../sessions/model/models";
import type { LinkedWorkItem } from "../../sessions/model/session";

export const HOST_PROTOCOL_VERSION = 1;
export const REMOTE_PROVIDERS = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
  "hermes",
  "antigravity",
  "gemini",
  "acp",
] as const;
export type RemoteProvider = (typeof REMOTE_PROVIDERS)[number];
export type HostDescriptor = {
  protocolVersion: number;
  environmentId: string;
  name: string;
  providers: RemoteProvider[];
  capabilities: string[];
  platform?: "win32" | "darwin" | "linux";
};
export type HostProject = { id: string; cwd: string; name: string };
export type HostProjectGroup = {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean;
};
/** A privacy-filtered directory. Each registered host ID remains a separate row. */
export type HostProjectDirectory = {
  version: 1;
  privacyReady: boolean;
  projects: (HostProject & { groupId?: string; registered: boolean })[];
  groups: HostProjectGroup[];
};
/** Sent only by the local desktop heartbeat; protected paths never reach the phone. */
export type DesktopProjectDirectory = {
  version: 1;
  projects: { cwd: string; name: string; groupId?: string }[];
  groups: HostProjectGroup[];
  excludedPaths: string[];
  excludedGroupIds: string[];
};
export type HostDirectory = {
  home?: string;
  roots?: { name: string; path: string }[];
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
};
export type HostModelCatalog = {
  models: Partial<Record<RemoteProvider, AgentModel[]>>;
  errors: Partial<Record<RemoteProvider, string>>;
};
export type HostWorktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  missing: boolean;
};
export type HostSession = {
  /** Client view is incomplete; never save this as an authoritative transcript. */
  history?: { before?: number; revision: number; totalBlocks: number };
  /** Client-only: tail is visible while bounded history pages hydrate. */
  historyLoading?: boolean;
  session: Session;
  projectId: string;
  revision: number;
  runId?: string;
  status: "idle" | "running" | "interrupted";
  /** Missing from snapshots written before creation time was stored. */
  createdAt?: number;
  updatedAt: number;
  archived?: boolean;
  pinned?: boolean;
  /** Temporary branch created by the composer for automatic first-turn naming. */
  autoWorktreeBranch?: string;
  /** Host-only: the revision at which each block last changed. */
  blockRevisions?: Record<string, number>;
  /** Shared with this machine's desktop app, whichever side started it: the
   * desktop copy's last `updated_at` the host has caught up with (0 before
   * the desktop has a copy). */
  desktop?: { updatedAt: number };
};
export type HostSessionSummary = Omit<HostSession, "session" | "blockRevisions" | "desktop"> & {
  issue?: "retrying" | "failed";
  issueTurnId?: string;
  issueMessage?: string;
  id: string;
  title: string;
  harness: RemoteProvider;
  cwd?: string;
  model?: string;
  runtimeMode?: RuntimeMode;
  providerSessionId?: string | null;
  createdAt?: number;
  linkedWorkItem?: LinkedWorkItem;
  needsInput?: boolean;
  branch?: string;
  worktreeCwd?: string;
  repo?: string;
  draft?: boolean;
  /** Set when the session lives in the bycoda app on the host machine, not yet adopted by the host. */
  origin?: "desktop";
};

export type RemoteAttachment = {
  browserAnnotation?: import("../../../shared/lib/browserAnnotation").BrowserAnnotationAttachment;
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "audio" | "file";
  size: number;
};

/** `sessions.sync` sends only the blocks that changed after the client's
 * revision, so a long transcript is not re-downloaded on every poll. */
export type SessionSync =
  | { kind: "unchanged"; revision: number }
  | { kind: "snapshot"; value: HostSession }
  | {
      kind: "delta";
      /** Only the client's loaded window and newly appended blocks are authoritative. */
      partial?: true;
      base: number;
      value: Omit<HostSession, "session" | "blockRevisions"> & {
        session: Omit<Session, "blocks">;
      };
      blockIds: string[];
      blocks: Block[];
    };

/** A sync too large for one response. Its serialized JSON is read in bounded
 * pieces with `sessions.syncChunk`, so every piece describes one revision. */
export type SessionSyncTransfer = {
  kind: "chunked";
  transfer: string;
  /** UTF-16 length of the serialized `SessionSync`. */
  length: number;
};
export type SessionSyncChunk = { data: string };
export type SessionSyncResponse = SessionSync | SessionSyncTransfer;

/** Throws when the delta does not apply to `known`; request a snapshot then. */
export function applySessionSync(known: HostSession | undefined, sync: SessionSync): HostSession {
  if (sync.kind === "snapshot") return sync.value;
  if (!known || known.revision !== (sync.kind === "delta" ? sync.base : sync.revision))
    throw new Error("Session sync base does not match");
  if (sync.kind === "unchanged") return known;
  if (sync.partial && !known.history)
    throw new Error("Partial session sync requires a history window");
  if (known.history && !sync.partial)
    throw new Error("Full delta cannot replace a partial history window");
  const blocks = new Map(known.session.blocks.map((block) => [block.id, block]));
  for (const block of sync.blocks) blocks.set(block.id, block);
  return {
    ...sync.value,
    session: {
      ...sync.value.session,
      blocks: sync.blockIds.map((id) => {
        const block = blocks.get(id);
        if (!block) throw new Error("Session sync is missing a block");
        // The full-content endpoint pins the whole session revision, including
        // status-only changes that did not replace this block's preview.
        return block.remoteContent && block.remoteContent.revision !== sync.value.revision
          ? {
              ...block,
              remoteContent: {
                ...block.remoteContent,
                revision: sync.value.revision,
              },
            }
          : block;
      }),
    },
  };
}
/** Machine-level invalidations share one authenticated control lane. Revisions
 * recover state through sessions.sync; notifications need no unbounded replay log. */
export type MachineChangesRequest = {
  /** Native per-window registration token, not a host identity. */
  subscriptionId?: string;
  tasksKnown?: string;
  instanceId?: string;
  sessions: { sessionId: string; revision: number }[];
  projects: { projectId: string; known?: string }[];
  /** Checkouts (host paths) whose `.git` the host watches; hosts with `git.watch`. */
  git?: { cwd: string; known?: string }[];
  waitMs?: number;
};
export type MachineChanges = {
  tasks?: { etag: string };
  instanceId: string;
  reset: boolean;
  sessions: { sessionId: string; revision: number; deleted?: boolean }[];
  projects: {
    projectId: string;
    etag: string;
    sessions?: HostSessionSummary[];
    base?: string;
    upserts?: HostSessionSummary[];
    removed?: string[];
  }[];
  git?: GitWatchChange[];
};
export type GitWatchChange = {
  cwd: string;
  etag: string;
  index: boolean;
  refs: boolean;
  /** False when the host cannot fully watch the checkout. */
  watching: boolean;
};
/** Owner, runner and project location are independent; tools never transfer ownership. */
export type SessionReference = { environmentId: string; sessionId: string };
export function sessionReferenceKey(reference: SessionReference): string {
  return JSON.stringify([reference.environmentId, reference.sessionId]);
}
export type HostCommand = HostCommandBody & {
  /** Atomic queue validation/consumption on hosts advertising sessions.queue. */
  queued?: { id: string; clientId: string; revision: number };
};
type HostCommandBody =
  | {
      type: "steer";
      commandId: string;
      sessionId: string;
      runId: string;
      text: string;
      attachments?: RemoteAttachment[];
    }
  | {
      type: "create";
      commandId: string;
      projectId: string;
      worktreeCwd?: string;
      autoWorktreeBranch?: string;
      harness: RemoteProvider;
      model: string;
      modelSettings?: Record<string, string>;
      runtimeMode: RuntimeMode;
      /** Atomic creation plus durable first turn on capable hosts. */
      firstTurn?: Extract<HostCommand, { type: "send" | "draft" }>;
    }
  | {
      type: "configure";
      commandId: string;
      sessionId: string;
      /** Supported by hosts advertising sessions.harnessSwitch. */
      harness?: RemoteProvider;
      model: string;
      modelSettings: Record<string, string>;
      runtimeMode: RuntimeMode;
    }
  | {
      type: "compact";
      commandId: string;
      sessionId: string;
      resumeAtReset?: boolean;
    }
  | {
      type: "send";
      commandId: string;
      sessionId: string;
      /** The desktop's "Resume at reset" setting for a limit this turn hits. */
      resumeAtReset?: boolean;
      text: string;
      attachments?: RemoteAttachment[];
      intent?: "default" | "plan" | "build";
      draftBlockId?: string;
      planBlockId?: string;
    }
  | {
      type: "draft";
      commandId: string;
      sessionId: string;
      text: string;
      attachments?: RemoteAttachment[];
    }
  | {
      type: "removeDraft";
      commandId: string;
      sessionId: string;
      draftBlockId: string;
    }
  | {
      type: "rewind";
      commandId: string;
      sessionId: string;
      blockId: string;
      expectedRevision?: number;
    }
  /** A `!command` from the composer: runs on the host, with no model turn. */
  | { type: "shell"; commandId: string; sessionId: string; line: string }
  | {
      type: "usageLimit";
      commandId: string;
      sessionId: string;
      action: "arm" | "disarm" | "dismiss";
    }
  | { type: "cancel"; commandId: string; sessionId: string; runId: string }
  | {
      type: "approve";
      commandId: string;
      sessionId: string;
      runId: string;
      requestId: number;
      decision: "allow" | "deny";
    }
  | {
      type: "answer";
      commandId: string;
      sessionId: string;
      runId: string;
      requestId: number;
      reply: UserQuestionReply;
    };
export type CommandReceipt = {
  commandId: string;
  sessionId: string;
  revision: number;
  /** The exact run accepted for this command, retained across receipt replay. */
  runId?: string;
};

/** Credentials never leave the desktop's native connection store. */
export type RemoteMachine = {
  id: string;
  name: string;
  endpoint: string;
  environmentId: string;
  /** Set by native local-host pairing; independent of the editable display name. */
  localHost?: boolean;
  ssh?: {
    target: string;
    port?: number | null;
    remotePort: number;
    /** A second address for the same machine (such as its Tailscale one);
     * the desktop dials whichever answers. */
    alternate?: string | null;
  } | null;
};

export type SshSetup = {
  id: string;
  message: string;
  prompt?: { id: string; message: string; confirm: boolean } | null;
  done: boolean;
  error?: string | null;
  machine?: RemoteMachine | null;
};

export function isRemoteProvider(value: unknown): value is RemoteProvider {
  return typeof value === "string" && REMOTE_PROVIDERS.some((provider) => provider === value);
}

export function requireHostDescriptor(value: HostDescriptor): HostDescriptor {
  if (
    value?.protocolVersion !== HOST_PROTOCOL_VERSION ||
    typeof value.environmentId !== "string" ||
    !value.environmentId ||
    !Array.isArray(value.providers) ||
    !value.providers.every(isRemoteProvider)
  ) {
    throw new Error("This machine is running an incompatible bycoda Host");
  }
  return value;
}
