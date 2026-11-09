import { createStore } from "../../../shared/lib/store";
import { pathKey } from "../../../shared/lib/paths";

/**
 * What another device did here (or this machine's own Host did elsewhere) that
 * the person in front of this screen did not do themselves. Every remote action
 * that changes what this screen shows records one entry, so both machines show
 * what happened instead of one changing silently.
 */
export type RemoteActivityKind =
  | "deleted"
  | "archived"
  | "stopped"
  | "takenOver"
  | "approved"
  | "answered"
  | "inbox"
  | "worktreeChanged"
  | "settingsChanged";

/** Project notices use the project path; inbox notices use the "inbox" scope. */
export type RemoteActivityScope = { cwd: string } | "inbox";

export type RemoteActivityNotice = {
  scope: RemoteActivityScope;
  kind: RemoteActivityKind;
  done: number;
  failed: number;
  /** Acting device names, most recent last; empty when unknown. */
  devices: string[];
};

const MAX_DEVICES = 3;
let snapshot: readonly RemoteActivityNotice[] = [];
const store = createStore();
export const getRemoteActivityNotices = () => snapshot;
export const subscribeRemoteActivityNotices = store.subscribe;

const scopeKey = (scope: RemoteActivityScope) =>
  scope === "inbox" ? "inbox" : `cwd:${pathKey(scope.cwd)}`;

/** Records one remote action. Actions of one kind in one scope add up in a single
 * notice until it is dismissed, so a bulk action shows one line. */
export function noteRemoteActivity(input: {
  scope: RemoteActivityScope;
  kind: RemoteActivityKind;
  /** Name of the device that acted, when known. */
  device?: string;
  /** false when the action was asked for but did not happen. */
  ok?: boolean;
}): void {
  const key = scopeKey(input.scope);
  const current = snapshot.find(
    (entry) => entry.kind === input.kind && scopeKey(entry.scope) === key,
  );
  const ok = input.ok !== false;
  const device = input.device?.trim().slice(0, 160);
  const next: RemoteActivityNotice = {
    scope: current?.scope ?? input.scope,
    kind: input.kind,
    done: (current?.done ?? 0) + (ok ? 1 : 0),
    failed: (current?.failed ?? 0) + (ok ? 0 : 1),
    devices: device
      ? [...(current?.devices ?? []).filter((name) => name !== device), device].slice(-MAX_DEVICES)
      : (current?.devices ?? []),
  };
  snapshot = [...snapshot.filter((entry) => entry !== current), next];
  store.notify();
}

export function dismissRemoteActivityNotice(notice: RemoteActivityNotice): void {
  const key = scopeKey(notice.scope);
  snapshot = snapshot.filter(
    (entry) => !(entry.kind === notice.kind && scopeKey(entry.scope) === key),
  );
  store.notify();
}
