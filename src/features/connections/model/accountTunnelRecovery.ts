import { invoke } from "@tauri-apps/api/core";

type Computer = { environmentId: string; routes: { endpoint: string }[] };
type Dependencies = {
  list: () => Promise<{ items: Computer[] }>;
  learn: (machineId: string, environmentId: string, routes: string[]) => Promise<boolean>;
};
const defaults: Dependencies = {
  // Loaded on first use: a static import pulls the account feature (and its
  // session imports) into every module that imports connections.
  list: async () => (await import("../../account")).accountApi().listComputers(),
  learn: (machineId, environmentId, routes) =>
    invoke("remote_learn_account_routes", {
      machineId,
      environmentId,
      routes,
    }),
};
const pending = new Map<string, Promise<boolean>>();

/** Re-fetch only after native exhausted known routes. Native verifies before credentials. */
export function recoverAccountTunnel(
  machineId: string,
  environmentId: string,
  dependencies: Dependencies = defaults,
): Promise<boolean> {
  const key = `${machineId}\0${environmentId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const list = await dependencies.list();
    const computer = list.items.find((item) => item.environmentId === environmentId);
    if (!computer) return false;
    return dependencies.learn(
      machineId,
      environmentId,
      computer.routes.map((route) => route.endpoint).slice(0, 4),
    );
  })()
    .catch(() => false)
    .finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

/** Only reconnect probes retry; an effect with an unknown outcome is never replayed. */
export async function withAccountTunnelRecovery<T>(
  method: string,
  machine: { id: string; environmentId: string; localHost?: boolean } | undefined,
  current: () => boolean,
  send: () => Promise<T>,
  recover = recoverAccountTunnel,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    const text = String(error);
    if (
      method !== "environment.describe" ||
      !machine ||
      machine.localHost ||
      !current() ||
      !/Machine is unreachable|The host request did not complete|RPC_WS_UNAVAILABLE|RPC_WS_DEADLINE|RPC_CONNECTION_INTERRUPTED|Invalid host response|Host returned HTTP 5\d\d/.test(
        text,
      )
    )
      throw error;
    if (!(await recover(machine.id, machine.environmentId)) || !current()) throw error;
    return send();
  }
}
