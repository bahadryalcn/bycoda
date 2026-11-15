import type { Computer } from "@bycoda/account-contracts";
import type { AccountPairPlan } from "./accountDesktopPairing";
import type { RemoteMachine } from "./protocol";

export type CandidateSource = "account" | "tailscale" | "ssh-config" | "known-hosts" | "servers";
export type CandidateRouteKind = "lan" | "tailscale" | "tunnel" | "name";
export type CandidateRoute = { address: string; kind: CandidateRouteKind };

/** One machine the desktop could add. The Rust `discover_machine_candidates` command returns the same shape. */
export type MachineCandidate = {
  key: string;
  name: string;
  os?: "macos" | "windows" | "linux";
  online?: boolean;
  sources: CandidateSource[];
  routes: CandidateRoute[];
  environmentId?: string;
  sshUser?: string;
  alreadyAdded: boolean;
  group?: "shared" | "mobile";
  /** An account computer: its account device id and published https Host routes, for account-mediated pairing. */
  accountPair?: { deviceId: string; routes: string[] };
};

/** A merged candidate. `sshRoutes` are the routes a native source vouches for; account routes are Host routes, not SSH. */
export type DiscoveredMachine = MachineCandidate & {
  sshRoutes: CandidateRoute[];
};

/** The account directory is re-published every 10 minutes; a computer is online while it is fresher than this. */
export const ACCOUNT_ONLINE_WINDOW_MS = 15 * 60_000;

const SOURCE_RANK: Record<CandidateSource, number> = {
  account: 0,
  tailscale: 1,
  "ssh-config": 2,
  "known-hosts": 2,
  servers: 2,
};

/** `user@host:port` or a URL down to its lower-case host. */
export function hostOf(address: string): string {
  const text = address.trim();
  try {
    if (text.includes("://")) return new URL(text).hostname.toLowerCase();
  } catch {
    // -- not a URL after all; fall through to the plain-host rules.
  }
  const withoutUser = text.slice(text.lastIndexOf("@") + 1);
  const bracket = /^\[([^\]]+)\]/.exec(withoutUser);
  if (bracket?.[1]) return bracket[1].toLowerCase();
  const parts = withoutUser.split(":");
  return (parts.length === 2 ? parts[0]! : withoutUser).replace(/\.$/, "").toLowerCase();
}

function routeKindOfHost(host: string): CandidateRouteKind {
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || host.endsWith(".ts.net"))
    return "tailscale";
  if (
    host === "localhost" ||
    /^(10|127)\./.test(host) ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("169.254.") ||
    host.endsWith(".local") ||
    host.startsWith("fe80:")
  )
    return "lan";
  return host.includes(".") ? "tunnel" : "name";
}

function osOf(platform: Computer["platform"]): MachineCandidate["os"] {
  return platform === "windows" || platform === "macos" || platform === "linux"
    ? platform
    : undefined;
}

/** An account computer as a candidate; its routes keep only the host, since the Host port is not SSH. */
export function candidateFromComputer(
  computer: Computer,
  now: number = Date.now(),
): MachineCandidate {
  const seen = Date.parse(computer.lastSeenAt);
  const routes: CandidateRoute[] = [];
  for (const route of computer.routes) {
    const address = hostOf(route.endpoint);
    if (address && !routes.some((entry) => entry.address === address))
      routes.push({ address, kind: routeKindOfHost(address) });
  }
  return {
    key: `account:${computer.environmentId}`,
    name: computer.name,
    os: osOf(computer.platform),
    online: Number.isFinite(seen) ? now - seen <= ACCOUNT_ONLINE_WINDOW_MS : undefined,
    sources: ["account"],
    routes,
    environmentId: computer.environmentId,
    alreadyAdded: false,
    accountPair: {
      deviceId: computer.deviceId,
      routes: computer.routes
        .filter((route) => route.lanKey === undefined && route.endpoint.startsWith("https://"))
        .map((route) => route.endpoint),
    },
    ...(computer.platform === "ios" || computer.platform === "android"
      ? { group: "mobile" as const }
      : {}),
  };
}

/** Identity tokens in priority order: environment id, tailscale address, ssh host. */
function identityTokens(candidate: MachineCandidate): string[] {
  const tokens: string[] = [];
  if (candidate.environmentId) tokens.push(`env:${candidate.environmentId}`);
  for (const route of candidate.routes)
    if (route.kind === "tailscale") tokens.push(`ts:${hostOf(route.address)}`);
  for (const route of candidate.routes)
    if (route.kind === "name") tokens.push(`ssh:${hostOf(route.address)}`);
  return tokens;
}

function mergeOnline(a: boolean | undefined, b: boolean | undefined): boolean | undefined {
  if (a || b) return true;
  return a === false || b === false ? false : undefined;
}

function mergeInto(target: DiscoveredMachine, next: MachineCandidate): void {
  const fromAccount = next.sources.includes("account");
  target.os ??= next.os;
  target.online = mergeOnline(target.online, next.online);
  target.environmentId ??= next.environmentId;
  target.sshUser ??= next.sshUser;
  target.accountPair ??= next.accountPair;
  target.alreadyAdded ||= next.alreadyAdded;
  for (const source of next.sources)
    if (!target.sources.includes(source)) target.sources.push(source);
  for (const route of next.routes) {
    if (!target.routes.some((entry) => entry.address === route.address)) target.routes.push(route);
    const ssh = !fromAccount && route.kind !== "tunnel";
    if (ssh && !target.sshRoutes.some((entry) => entry.address === route.address))
      target.sshRoutes.push(route);
  }
  // A machine that is also an account computer is not "shared" noise.
  if (target.sources.includes("account") && target.group === "shared") delete target.group;
}

function isSaved(candidate: MachineCandidate, saved: RemoteMachine[]): boolean {
  if (candidate.alreadyAdded) return true;
  const hosts = new Set(candidate.routes.map((route) => hostOf(route.address)));
  return saved.some((machine) => {
    if (candidate.environmentId && machine.environmentId === candidate.environmentId) return true;
    return [machine.ssh?.target, machine.ssh?.alternate, machine.endpoint]
      .filter((value): value is string => Boolean(value))
      .some((value) => hosts.has(hostOf(value)));
  });
}

function bestSourceRank(candidate: MachineCandidate): number {
  return Math.min(...candidate.sources.map((source) => SOURCE_RANK[source]), 9);
}

/**
 * One sorted list from the account's computers and the native candidates. The same machine
 * seen by several sources is one row (matched by environment id, then tailscale address, then
 * ssh host). Order: online first, then account, tailscale and config-only, then name.
 */
export function mergeMachineCandidates({
  account,
  native,
  saved,
}: {
  account: MachineCandidate[];
  native: MachineCandidate[];
  saved: RemoteMachine[];
}): DiscoveredMachine[] {
  const groups: DiscoveredMachine[] = [];
  const index = new Map<string, DiscoveredMachine>();
  for (const candidate of [...account, ...native]) {
    const match = identityTokens(candidate)
      .map((token) => index.get(token))
      .find(
        (group) =>
          group &&
          !(
            group.environmentId &&
            candidate.environmentId &&
            group.environmentId !== candidate.environmentId
          ),
      );
    let group = match;
    if (!group) {
      group = {
        key: candidate.key,
        name: candidate.name,
        sources: [],
        routes: [],
        sshRoutes: [],
        alreadyAdded: false,
        ...(candidate.group ? { group: candidate.group } : {}),
      };
      groups.push(group);
    }
    mergeInto(group, candidate);
    for (const token of identityTokens(group)) if (!index.has(token)) index.set(token, group);
  }
  for (const group of groups) group.alreadyAdded = isSaved(group, saved);
  return groups.sort(
    (a, b) =>
      Number(b.online === true) - Number(a.online === true) ||
      bestSourceRank(a) - bestSourceRank(b) ||
      a.name.localeCompare(b.name),
  );
}

export type SshAddPlan = {
  target: string;
  alternate: string | null;
  name: string;
};

/** The SSH add this candidate allows, or null when it has no SSH route (account only). */
export function sshAddPlan(candidate: DiscoveredMachine): SshAddPlan | null {
  const order: CandidateRouteKind[] = ["name", "tailscale", "lan"];
  const routes = order.flatMap((kind) =>
    candidate.sshRoutes.filter((route) => route.kind === kind),
  );
  const first = routes[0];
  if (!first) return null;
  const withUser = (address: string) =>
    candidate.sshUser && !address.includes("@") ? `${candidate.sshUser}@${address}` : address;
  const second = routes.find((route) => route.address !== first.address);
  return {
    target: withUser(first.address),
    alternate: second ? withUser(second.address) : null,
    name: candidate.name,
  };
}

/** What account-mediated pairing needs, or null when the computer is not an account Host with a published https route. */
export function accountPairPlan(candidate: DiscoveredMachine): AccountPairPlan | null {
  const pair = candidate.accountPair;
  if (!pair || !candidate.environmentId || pair.routes.length === 0) return null;
  return {
    deviceId: pair.deviceId,
    environmentId: candidate.environmentId,
    name: candidate.name,
    routes: pair.routes.slice(0, 4),
  };
}
