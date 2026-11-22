import { invoke } from "@tauri-apps/api/core";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import { hostProjectCwd, machineProjects } from "../../automations/public/hostMachines";
import { accountNeedsSignIn, socialClient } from "../../social/public/waiting";
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

type Accounts = Parameters<typeof buildSocialWaiting>[0]["accounts"];
type SocialClient = ReturnType<typeof socialClient>;

/**
 * How long one Host's accounts snapshot is reused by the waiting poll. Sign-in expiry is still
 * judged against the clock on every poll, and an account whose expiry falls inside this window is
 * always read fresh, so renewals and expiries are not hidden by the cache.
 */
const ACCOUNTS_TTL_MS = 5 * 60_000;

/** Last good accounts snapshot per Host id: one Host never reads another Host's accounts. */
const accountsByHost = new Map<string, { at: number; accounts: Accounts }>();

/**
 * The accounts snapshot of one Host, reused between polls while it is fresh and no account
 * expires soon. A failed read is not cached: it reads as no accounts, as before, and is tried again.
 */
async function readAccounts(machineId: string, client: SocialClient): Promise<Accounts> {
  const now = Date.now();
  const cached = accountsByHost.get(machineId);
  if (
    cached &&
    now - cached.at < ACCOUNTS_TTL_MS &&
    !cached.accounts.some(
      (account) => account.expiresAt !== undefined && account.expiresAt <= now + ACCOUNTS_TTL_MS,
    )
  ) {
    return cached.accounts;
  }
  // The Host's page limit is 1–100 (host/social/social.ts `workspaceSnapshot`); 200 was refused
  // as "Invalid page limit" on every poll, so due sign-ins were never seen.
  const accounts = await client.sectionSnapshot({ section: "accounts", limit: 100 }).then(
    (response) => response.snapshot?.accounts,
    () => undefined,
  );
  if (!accounts) return [];
  accountsByHost.set(machineId, { at: Date.now(), accounts });
  return accounts;
}

/**
 * What waits for the owner on one Host: pending project account requests and browser tasks
 * that need a person, plus accounts whose sign-in is due. The lists are read every call. A list
 * that cannot be read contributes nothing and is read again next time; it never reads as "nothing
 * waits" to the caller, which returns `undefined` when neither list could be read.
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
  const accounts = await readAccounts(machine.id, client);
  const now = Date.now();
  // Projects only name the paths of items. With no list item and no sign-in due, nothing needs them.
  const signInDue = accounts.some((account) => accountNeedsSignIn(account, now));
  if (!requests?.length && !humans?.length && !signInDue) return [];
  const projects = await machineProjects(machine).catch(() => []);
  return buildSocialWaiting({
    requests: requests ?? [],
    humans: humans ?? [],
    accounts,
    pathOfProject: new Map(
      projects.map((project) => [project.id, hostProjectCwd(machine, project)]),
    ),
  });
}
