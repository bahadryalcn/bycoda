import { invoke } from "@tauri-apps/api/core";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import { hostProjectCwd, machineProjects } from "../../automations/public/hostMachines";
import { socialClient } from "../../social/public/waiting";
import { buildSocialWaiting, type SocialWaitingItem } from "./socialWaiting";

/** The computer Social runs on: the authority Host when one is set, otherwise this computer. */
export async function socialMachine(): Promise<RemoteMachine | undefined> {
  const [machines, authority] = await Promise.all([
    invoke<RemoteMachine[]>("remote_machines"),
    invoke<{ authorityMachineId?: string }>("social_authority_status").catch(() => null),
  ]);
  const list = Array.isArray(machines) ? machines : [];
  return (
    list.find((machine) => machine.id === authority?.authorityMachineId) ??
    list.find(isLocalSyncMachine)
  );
}

/**
 * What waits for the owner on one Host: pending project account requests and browser tasks
 * that need a person. Both reads are the lists the Command screen shows. A list that cannot be
 * read contributes nothing and is read again next time; it never reads as "nothing waits"
 * to the caller, which returns `undefined` when neither list could be read.
 */
export async function readSocialWaiting(
  machine: RemoteMachine,
): Promise<SocialWaitingItem[] | undefined> {
  const client = socialClient(machine.id);
  const [requests, humans] = await Promise.all([
    client.accountRequests.list().then(
      (result) => result.items,
      () => undefined,
    ),
    client.browser.needsHuman.list().then(
      (result) => result.items,
      () => undefined,
    ),
  ]);
  if (!requests && !humans) return undefined;
  const [projects, accounts] = await Promise.all([
    machineProjects(machine).catch(() => []),
    client.sectionSnapshot({ section: "accounts", limit: 200 }).then(
      (response) => response.snapshot?.accounts ?? [],
      () => [],
    ),
  ]);
  return buildSocialWaiting({
    requests: requests ?? [],
    humans: humans ?? [],
    accounts,
    pathOfProject: new Map(
      projects.map((project) => [project.id, hostProjectCwd(machine, project)]),
    ),
  });
}
