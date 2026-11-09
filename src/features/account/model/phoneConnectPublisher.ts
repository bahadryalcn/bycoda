import { AccountApiError, ConnectInfoUpdate, type AccountClient } from "@bycoda/account-contracts";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

/** What the Host reports in `environment.describe` that phones need. */
export type PhoneConnectHost = {
  environmentId: string;
  name: string;
  mobileRoutes?: { endpoint: string; lanKey?: string }[];
};

/** The Host is re-read this often; a change is published at the next check. */
export const PHONE_CONNECT_CHECK_MS = 60_000;
/** Unchanged info is re-sent this often so the directory entry stays fresh. */
export const PHONE_CONNECT_HEARTBEAT_MS = 10 * 60_000;

/** Route hints are display data for phones; entries the contract rejects are dropped, not sent. */
export function buildConnectInfo(host: PhoneConnectHost): ConnectInfoUpdate | null {
  const routes = (host.mobileRoutes ?? [])
    .filter((route) => ConnectInfoUpdate.shape.routes.element.safeParse(route).success)
    .slice(0, 4);
  const hostName = truncateGraphemes(host.name.trim(), 80, "");
  const parsed = ConnectInfoUpdate.safeParse({
    environmentId: host.environmentId,
    ...(hostName ? { hostName } : {}),
    routes,
  });
  return parsed.success ? parsed.data : null;
}

export type PhoneConnectPublisherDeps = {
  deviceId: string;
  api: Pick<AccountClient, "putConnectInfo" | "deleteConnectInfo">;
  /** The local Host's description, or null while it is not available. */
  describeHost: () => Promise<PhoneConnectHost | null>;
  checkMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
};

/**
 * Publishes where phones can reach this computer, until stopped: on start, when the info
 * changes, and as a heartbeat. Stopping removes the entry (best effort: after sign-out the token
 * is gone and the service drops the entry with the device). An API without the route (404)
 * ends publishing quietly.
 */
export function startPhoneConnectPublisher(deps: PhoneConnectPublisherDeps): () => void {
  const now = deps.now ?? Date.now;
  const params = { id: deps.deviceId };
  let stopped = false;
  let published = false;
  let lastSignature: string | null = null;
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    try {
      const host = await deps.describeHost();
      const info = host ? buildConnectInfo(host) : null;
      if (info && !stopped) {
        const signature = JSON.stringify(info);
        const due = now() - lastAt >= (deps.heartbeatMs ?? PHONE_CONNECT_HEARTBEAT_MS);
        if (signature !== lastSignature || due) {
          published = true;
          await deps.api.putConnectInfo({ params, body: info });
          lastSignature = signature;
          lastAt = now();
        }
      }
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 404) {
        stopped = true; // -- an API without phone connect: nothing to publish to.
        published = false;
        return;
      }
      deps.onError?.(error);
    }
    if (!stopped) timer = setTimeout(run, deps.checkMs ?? PHONE_CONNECT_CHECK_MS);
  }

  // Every tick is tracked so stop() can order its DELETE after an in-flight PUT.
  function run(): void {
    running = tick().catch(() => undefined); // -- tick handles its own failures.
  }

  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    // A tick that is already past its stopped check may still PUT; delete only after it settles.
    running
      .then(() => {
        if (!published) return;
        published = false;
        return deps.api.deleteConnectInfo({ params });
      })
      .catch(() => undefined); // -- best effort, see above.
  };
}
