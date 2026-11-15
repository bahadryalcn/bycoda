import { routeKindOfAddress, type MachineRouteKind } from "./machineSummary";
import type { RemoteMachine } from "./protocol";

export type RoutePreference = "saved" | "lan" | "tailscale";
export type MachineRoute = {
  address: string;
  kind: "tailscale" | "lan" | "name" | "tunnel" | "url";
  /** `account`: learned from the signed-in account (a Quick Tunnel). */
  source: "saved" | "other" | "reported" | "account";
  enabled: boolean;
};
export type MachineRoutes = {
  routes: MachineRoute[];
  prefer: RoutePreference;
  active?: string | null;
};

const hostOf = (address: string) =>
  address
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^[^@/]*@/, "")
    .replace(/[:/].*$/, "");

/** What a machine can be reached at from its own record, before the desktop's
 * route store answers; an endpoint machine's saved address is not in that store. */
export function savedRoutes(machine: RemoteMachine): MachineRoute[] {
  const first = machine.ssh?.target ?? machine.endpoint;
  const kind = routeKindOfAddress(first);
  const routes: MachineRoute[] = [
    {
      address: hostOf(first),
      kind: kind === "ssh" ? (machine.ssh ? "name" : "url") : kind,
      source: "saved",
      enabled: true,
    },
  ];
  if (machine.ssh?.alternate)
    routes.push({
      address: hostOf(machine.ssh.alternate),
      kind: routeKindOfAddress(machine.ssh.alternate) === "tailscale" ? "tailscale" : "lan",
      source: "other",
      enabled: true,
    });
  return routes;
}

/** The desktop's answer for the machine, with its saved endpoint first when the
 * machine has no SSH route list of its own. */
export function mergeRoutes(machine: RemoteMachine, native?: MachineRoutes): MachineRoutes {
  if (!native) return { routes: savedRoutes(machine), prefer: "saved" };
  if (machine.ssh) return native;
  const saved = savedRoutes(machine).slice(0, 1);
  // A learned tunnel can be the saved endpoint itself; it is one route.
  return {
    ...native,
    routes: [...saved, ...native.routes.filter((route) => route.address !== saved[0]?.address)],
  };
}

/** The route kind the summary line names and how many routes the machine has:
 * the one in use, else the first that is turned on. */
export function summarizeRoutes(routes: MachineRoutes): {
  kind?: MachineRouteKind;
  count: number;
} {
  const on = routes.routes.filter((route) => route.enabled);
  const current = on.find((route) => route.address === routes.active) ?? on[0];
  const kind = (route: MachineRoute): MachineRouteKind =>
    route.kind === "name" ? "ssh" : route.kind;
  return { kind: current ? kind(current) : undefined, count: on.length };
}
