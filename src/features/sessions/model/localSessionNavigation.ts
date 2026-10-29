import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { HostProject, HostSession, RemoteMachine } from "../../connections/model/protocol";
import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { getGroupLockView } from "../../group-lock/model/groupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { nativeSessionReference, resolveNativeSessionReference } from "./nativeSessionReference";
import type { LocalSessionLocator, LocalSessionReference } from "./localSessionReference";
import type { Session } from "./session";
import { t } from "../../../shared/i18n";

const unavailable = () => new Error(t("This local conversation is unavailable or inaccessible."));
export function assertReferenceProjectVisible(cwd: string): void {
  if (!cwd || isProjectLockedIn(getGroupLockView().lock, cwd)) throw unavailable();
}

/** Resolve only the current computer's Host, never a saved remote with a matching ID. */
async function localHost(environmentId: string): Promise<RemoteMachine> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect").catch(() => null);
  if (!machine || !isLocalSyncMachine(machine) || machine.environmentId !== environmentId)
    throw new Error(t("This link belongs to another local Host or profile."));
  return machine;
}

export type ResolvedLocalSession = {
  locator: LocalSessionLocator;
  title: string;
  cwd: string;
  archived: boolean;
  status?: string;
  host?: { machine: RemoteMachine; project: HostProject; snapshot: HostSession };
};

/** Read-only resolution. Nothing here adopts, resumes, unarchives or migrates a session. */
export async function resolveLocalSessionReference(
  reference: LocalSessionReference,
): Promise<ResolvedLocalSession> {
  const privacy = getGroupLockView();
  let locator = reference.locator;
  if (locator.kind === "native") {
    const metadata = await resolveNativeSessionReference(locator).catch(() => null);
    if (!metadata) throw unavailable();
    if (getGroupLockView() !== privacy) throw unavailable();
    assertReferenceProjectVisible(metadata.cwd);
    if (metadata.locator.kind === "native") return { ...metadata, archived: !!metadata.archived };
    locator = metadata.locator;
  }
  const hostLocator = locator;
  const machine = await localHost(hostLocator.environmentId);
  const request = <T>(method: string, params: Record<string, unknown>) =>
    remoteRequest<T>(machine.id, method, params, false, true, hostLocator.environmentId).catch(
      () => {
        throw unavailable();
      },
    );
  // Existing bounded preview read; its project must also exist in the authorized catalog.
  const projects = await request<HostProject[]>("projects.list", {});
  const snapshot = await request<HostSession>("sessions.get", {
    sessionId: locator.sessionId,
    preview: true,
    summary: true,
  });
  const project = projects.find((entry) => entry.id === snapshot.projectId);
  if (!project || snapshot.session.id !== locator.sessionId || getGroupLockView() !== privacy)
    throw unavailable();
  assertReferenceProjectVisible(project.cwd);
  return {
    locator,
    title: snapshot.session.title,
    cwd: project.cwd,
    archived: !!snapshot.archived,
    status: snapshot.status,
    host: { machine, project, snapshot },
  };
}

/** Copy only a proven persistent owner. Fresh unsent tabs have no reference yet. */
export async function localReferenceForSession(
  session: Pick<Session, "id" | "hostBinding">,
): Promise<LocalSessionLocator> {
  const binding = hostSessionBinding(session);
  let locator: LocalSessionLocator | null;
  if (binding) {
    if (!binding.created) throw new Error(t("Save a conversation turn before copying its link."));
    locator = { kind: "host", environmentId: binding.environmentId, sessionId: binding.sessionId };
  } else locator = await nativeSessionReference(session.id).catch(() => null);
  if (!locator) throw unavailable();
  await resolveLocalSessionReference({ locator });
  return locator;
}
