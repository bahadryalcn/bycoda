import type { Session } from "../../sessions/model/session";
import type { RemoteProject } from "./remoteProjects";

export type HostSessionBinding = {
  kind: "local-host";
  machineId: string;
  environmentId: string;
  projectId: string;
  /** Reserved before first send; never substituted following uncertain delivery. */
  sessionId: string;
  /** Null preserves canonical absence for an unfenced fresh Host session. */
  authorityGeneration: number | null;
  /** Receipt acknowledgement is independent of migration authority generation. */
  created: boolean;
};
const PREFIX = "bycoda.host-session-binding.v1:";

type StoredHostShell = {
  binding: HostSessionBinding;
  shell: Session;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  pinned?: boolean;
  deleted?: boolean;
};
function read(shellId: string): StoredHostShell | undefined {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(PREFIX + shellId);
  if (!raw) return;
  const value = JSON.parse(raw);
  const b = value?.binding;
  if (
    b?.kind !== "local-host" ||
    ![b.machineId, b.environmentId, b.projectId, b.sessionId].every(
      (v) => typeof v === "string" && !!v,
    ) ||
    (b.authorityGeneration !== null &&
      (!Number.isSafeInteger(b.authorityGeneration) || b.authorityGeneration < 1)) ||
    typeof b.created !== "boolean" ||
    value.shell?.id !== shellId
  )
    throw new Error("Invalid stored session owner; reconnect this conversation before sending.");
  return value;
}

export function hostSessionBinding(
  session: Pick<Session, "id" | "hostBinding">,
): HostSessionBinding | undefined {
  return read(session.id)?.binding ?? session.hostBinding;
}

/** Must succeed before making the new tab available. No transcript is written
 * into Native's authoritative store; this is only a local display/default cache. */
export function saveHostSessionBinding(shell: Session, binding: HostSessionBinding): Session {
  const next = { ...shell, hostBinding: binding };
  const previous = read(shell.id);
  if (previous?.deleted) throw new Error("This Host conversation was deleted.");
  if (
    previous &&
    ["environmentId", "machineId", "projectId", "sessionId"].some(
      (key) =>
        previous.binding[key as keyof HostSessionBinding] !==
        binding[key as keyof HostSessionBinding],
    )
  )
    throw new Error("The session owner changed while the request was in flight.");
  if (
    previous?.binding.authorityGeneration !== undefined &&
    previous.binding.authorityGeneration !== null &&
    (binding.authorityGeneration === null ||
      binding.authorityGeneration < previous.binding.authorityGeneration)
  )
    throw new Error("The session authority changed while the request was in flight.");
  if (previous?.binding.created && !binding.created)
    throw new Error("An acknowledged Host conversation cannot become uncreated.");
  localStorage.setItem(
    PREFIX + shell.id,
    JSON.stringify({
      ...previous,
      createdAt: previous?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      binding,
      shell: { ...next, blocks: [] },
    }),
  );
  return next;
}

/**
 * The binding a Host receipt or snapshot acknowledges. Pure validation with no
 * storage write: it throws when the owner changed, the Host returned another
 * session, or its authority generation moved backwards. Callers that also
 * project a display session from the receipt persist the result once through
 * `saveHostSessionBinding`, so a rejected owner leaves storage untouched.
 */
export function acknowledgedHostSessionBinding(
  shell: Session,
  sessionId: string,
  authorityGeneration: number | undefined,
): HostSessionBinding | undefined {
  const binding = hostSessionBinding(shell);
  if (!binding) return undefined;
  const expected = shell.hostBinding;
  if (
    expected &&
    ["environmentId", "machineId", "projectId", "sessionId"].some(
      (key) =>
        binding[key as keyof HostSessionBinding] !== expected[key as keyof HostSessionBinding],
    )
  )
    throw new Error("The session owner changed while the request was in flight.");
  if (
    binding.sessionId !== sessionId ||
    (authorityGeneration !== undefined &&
      (!Number.isSafeInteger(authorityGeneration) || authorityGeneration < 1)) ||
    (binding.authorityGeneration !== null &&
      (authorityGeneration === undefined || authorityGeneration < binding.authorityGeneration))
  )
    throw new Error("The Host returned a different session owner.");
  return { ...binding, created: true, authorityGeneration: authorityGeneration ?? null };
}

export function acknowledgeHostSessionBinding(
  shell: Session,
  sessionId: string,
  authorityGeneration: number | undefined,
): void {
  const binding = acknowledgedHostSessionBinding(shell, sessionId, authorityGeneration);
  if (binding) saveHostSessionBinding(shell, binding);
}

export function restoreHostSessionShell(shellId: string): Session | undefined {
  const stored = read(shellId);
  return stored ? { ...stored.shell, hostBinding: stored.binding, blocks: [] } : undefined;
}

export function hostSessionShellSummaries() {
  const summaries: Array<
    Pick<
      Session,
      | "id"
      | "cwd"
      | "title"
      | "harness"
      | "model"
      | "runtimeMode"
      | "worktreeCwd"
      | "branch"
      | "linkedWorkItem"
    > & {
      createdAt: number;
      updatedAt: number;
      archived?: boolean;
      pinned?: boolean;
    }
  > = [];
  if (typeof localStorage === "undefined") return summaries;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const stored = read(key.slice(PREFIX.length));
    if (!stored?.binding.created || stored.deleted) continue;
    const { shell, createdAt, updatedAt, archived, pinned } = stored;
    summaries.push({
      id: shell.id,
      cwd: shell.cwd,
      title: shell.title,
      harness: shell.harness,
      model: shell.model,
      runtimeMode: shell.runtimeMode,
      worktreeCwd: shell.worktreeCwd,
      branch: shell.branch,
      linkedWorkItem: shell.linkedWorkItem,
      createdAt,
      updatedAt,
      archived,
      pinned,
    });
  }
  return summaries;
}

export function patchHostSessionShellMetadata(
  shellId: string,
  patch: { archived?: boolean; pinned?: boolean },
): void {
  const stored = read(shellId);
  if (!stored) throw new Error("Missing session owner");
  localStorage.setItem(PREFIX + shellId, JSON.stringify({ ...stored, ...patch }));
}

export function forgetHostSessionShell(shellId: string): void {
  // A stale saved workspace must retain the routing fence after deletion.
  const stored = read(shellId);
  if (stored) localStorage.setItem(PREFIX + shellId, JSON.stringify({ ...stored, deleted: true }));
}

export function hostExecutionProject(shell: Session): RemoteProject | undefined {
  const binding = hostSessionBinding(shell);
  return binding
    ? {
        key: shell.cwd,
        cwd: shell.cwd,
        environmentId: binding.environmentId,
        projectId: binding.projectId,
      }
    : undefined;
}
