import { pathKey } from "../../../shared/lib/paths";
import { isProjectLocked } from "../../group-lock/public/projectLock";
import {
  accountNeedsSignIn,
  type NeedsHumanItem,
  SocialAccount,
  SocialAccountRequest,
  SocialPlatform,
} from "../../social/public/waiting";
import {
  allowsProjectNotification,
  allowsProjectNotificationIndicator,
} from "./notificationPreferences";
import { knownNotificationProject } from "./notificationProjects";

/** One Social item that waits for the owner, reduced to what a notification may say. */
export type SocialWaitingItem = {
  /** Stable across polls: the dedupe key of the announcement. */
  id: string;
  kind: "accountRequest" | "needsHuman" | "signIn";
  platform: SocialPlatform;
  reason?: NeedsHumanItem["reason"];
  /** The account a `signIn` item is about; the click opens it. */
  accountId?: string;
  /** Desktop paths of the projects the item belongs to; empty when no project is known. */
  paths: string[];
  at: number;
};

/** What a Social item's project allows right now. */
export type SocialWaitingVisibility = "open" | "locked" | "muted";

/**
 * Project mute and group lock for one item. A request belongs to one project, a waiting browser
 * task to every project its account is granted to: it is muted only when all of them are muted
 * and masked when any of them is locked. An item without a known project is never muted.
 * `indicator` asks about counters, which follow current preferences instead of the arrival time.
 */
export function socialWaitingVisibility(
  item: SocialWaitingItem,
  options: { indicator?: boolean; now?: number } = {},
): SocialWaitingVisibility {
  const now = options.now ?? Date.now();
  if (item.paths.some(isProjectLocked)) return "locked";
  const projects = item.paths.flatMap((path) => knownNotificationProject(path) ?? []);
  if (!projects.length) return "open";
  const allowed = projects.some((project) =>
    options.indicator
      ? allowsProjectNotificationIndicator(
          { projectId: project.id, category: "agentInput" },
          undefined,
          now,
        )
      : allowsProjectNotification(
          { projectId: project.id, category: "agentInput", occurredAt: item.at },
          now,
        ),
  );
  return allowed ? "open" : "muted";
}

/** Joins the Host's lists into items. `pathOfProject` maps a Host project id to a desktop path. */
export function buildSocialWaiting(input: {
  requests: readonly SocialAccountRequest[];
  humans: readonly NeedsHumanItem[];
  accounts: readonly Pick<
    SocialAccount,
    "id" | "platform" | "grants" | "connected" | "paused" | "expiresAt" | "connection"
  >[];
  pathOfProject: ReadonlyMap<string, string>;
  now?: number;
}): SocialWaitingItem[] {
  const pathFor = (projectId: string) => input.pathOfProject.get(projectId);
  const items: SocialWaitingItem[] = [];
  for (const request of input.requests) {
    if (request.status !== "pending") continue;
    const path = pathFor(request.projectId);
    items.push({
      id: `request:${request.id}`,
      kind: "accountRequest",
      platform: request.platform,
      paths: path ? [path] : [],
      at: request.createdAt,
    });
  }
  const grants = new Map(input.accounts.map((account) => [account.id, account.grants]));
  const pathsOf = (accountId: string) => {
    const granted = Object.entries(grants.get(accountId) ?? {})
      .filter(([, permissions]) => permissions.length > 0)
      .flatMap(([projectId]) => pathFor(projectId) ?? []);
    return [...new Map(granted.map((path) => [pathKey(path), path])).values()];
  };
  for (const human of input.humans) {
    items.push({
      id: `human:${human.id}`,
      kind: "needsHuman",
      platform: human.platform,
      reason: human.reason,
      paths: pathsOf(human.accountId),
      at: human.at,
    });
  }
  const now = input.now ?? Date.now();
  for (const account of input.accounts) {
    // The expiry value is in the id: a later expiry of the same account announces again.
    if (!accountNeedsSignIn(account, now) || account.expiresAt === undefined) continue;
    items.push({
      id: `signin:${account.id}:${account.expiresAt}`,
      kind: "signIn",
      platform: account.platform,
      accountId: account.id,
      paths: pathsOf(account.id),
      at: account.expiresAt,
    });
  }
  return items;
}

const ANNOUNCED_KEY = "bycoda.notifications.social.announced.v1";
const MAX_ANNOUNCED = 300;

/** Ids of Social items this computer already announced (or deliberately skipped), newest last. */
export function loadAnnouncedSocial(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ANNOUNCED_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function rememberAnnouncedSocial(ids: readonly string[]): void {
  if (!ids.length) return;
  try {
    const merged = [...new Set([...loadAnnouncedSocial(), ...ids])];
    localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(merged.slice(-MAX_ANNOUNCED)));
  } catch {
    // Unwritable storage means an item may be announced again after a restart.
  }
}

let waitingCount = 0;
const waitingListeners = new Set<() => void>();

/** How many Social items wait for the owner right now, after mute and lock; read by the counters. */
export function socialWaitingCount(): number {
  return waitingCount;
}

export function setSocialWaitingCount(count: number): void {
  if (count === waitingCount) return;
  waitingCount = count;
  for (const listener of waitingListeners) listener();
}

export function subscribeSocialWaiting(listener: () => void): () => void {
  waitingListeners.add(listener);
  return () => waitingListeners.delete(listener);
}
