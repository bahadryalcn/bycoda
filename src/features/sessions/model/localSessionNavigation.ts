import { invoke } from "@tauri-apps/api/core";
import { remoteMachineFor, remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { HostProject, HostSession, RemoteMachine } from "../../connections";
import { hostSessionBinding } from "../../connections/public/sessionExecutionBinding";
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

/** Local fallback is proven by Native; paired Hosts retain their own exact identity. */
async function localHost(environmentId: string): Promise<RemoteMachine> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect").catch(() => null);
  if (!machine || !isLocalSyncMachine(machine) || machine.environmentId !== environmentId)
    throw new Error(t("This link belongs to another local Host or profile."));
  return machine;
}

async function resolveOnHost(
  machine: RemoteMachine,
  reference: LocalSessionReference,
  privacy: ReturnType<typeof getGroupLockView>,
  requireReferenceGuard: boolean,
): Promise<ResolvedLocalSession> {
  const request = <T>(method: string, params: Record<string, unknown>) =>
    remoteRequest<T>(machine.id, method, params, false, true, machine.environmentId);
  if (requireReferenceGuard) {
    const descriptor = await request<{ environmentId: string; capabilities: string[] }>(
      "environment.describe",
      {},
    );
    if (
      descriptor.environmentId !== machine.environmentId ||
      !descriptor.capabilities?.includes("sessions.references.v1")
    )
      throw unavailable();
  }
  if (getGroupLockView() !== privacy) throw unavailable();
  const projects = await request<HostProject[]>("projects.list", {});
  const snapshot = await request<HostSession>("sessions.get", {
    sessionId: reference.locator.sessionId,
    preview: true,
    summary: true,
    ...(requireReferenceGuard ? { reference: reference.locator } : {}),
  });
  const project = projects.find((entry) => entry.id === snapshot.projectId);
  if (
    !project ||
    snapshot.session.id !== reference.locator.sessionId ||
    getGroupLockView() !== privacy
  )
    throw unavailable();
  assertReferenceProjectVisible(project.cwd);
  return {
    locator: { kind: "host", environmentId: machine.environmentId, sessionId: snapshot.session.id },
    title: snapshot.session.title,
    cwd: project.cwd,
    archived: !!snapshot.archived,
    status: snapshot.status,
    host: { machine, project, snapshot },
  };
}

async function resolvePairedNative(
  reference: LocalSessionReference,
  privacy: ReturnType<typeof getGroupLockView>,
) {
  const machines = await invoke<RemoteMachine[]>("remote_machines").catch(() => []);
  if (!Array.isArray(machines) || getGroupLockView() !== privacy) throw unavailable();
  // Read only already-paired Hosts. The authenticated reference guard must prove
  // the complete origin; matching a bare session ID never establishes ownership.
  const found = (
    await Promise.all(
      machines.map((machine) => resolveOnHost(machine, reference, privacy, true).catch(() => null)),
    )
  ).filter((value): value is ResolvedLocalSession => value !== null);
  if (found.length !== 1 || getGroupLockView() !== privacy) throw unavailable();
  return found[0];
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
    if (!metadata) return resolvePairedNative(reference, privacy);
    if (getGroupLockView() !== privacy) throw unavailable();
    assertReferenceProjectVisible(metadata.cwd);
    if (metadata.locator.kind === "native") return { ...metadata, archived: !!metadata.archived };
    locator = metadata.locator;
  }
  const hostLocator = locator;
  const machine = await localHost(hostLocator.environmentId).catch(() => null);
  if (machine)
    return resolveOnHost(machine, { ...reference, locator }, privacy, false).catch(() => {
      throw unavailable();
    });
  const paired = await remoteMachineFor(hostLocator.environmentId).catch(() => undefined);
  if (!paired || paired.environmentId !== hostLocator.environmentId) throw unavailable();
  return resolveOnHost(paired, { ...reference, locator }, privacy, true).catch(() => {
    throw unavailable();
  });
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
