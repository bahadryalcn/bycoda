import type { PendingChange } from "../../../../shared/ui/settings";

export type OrderTab = "jobs" | "models" | "groups" | "agents" | "limits";

/** The tab a pending change belongs to, from the id `orderChanges` gives it. */
function tabOf(change: PendingChange): OrderTab | undefined {
  const id = change.id;
  if (id.startsWith("entries:")) return "models";
  if (id.startsWith("pool:")) return "groups";
  if (id.startsWith("role:")) return "jobs";
  if (id === "delegation") return "agents";
  if (id.startsWith("limit:")) return "limits";
  return undefined;
}

/** Tabs holding unsaved changes; one shared draft is saved once for all of them. */
export function changedTabs(changes: readonly PendingChange[]): ReadonlySet<OrderTab> {
  return new Set(changes.flatMap((change) => tabOf(change) ?? []));
}
