import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { applyRemoteConnection } from "./remoteHealth";

/** Sent by the desktop when the SSH process behind a machine's tunnel ends by
 * itself (never when the app closed it). See `remote_ssh.rs`. */
export const TUNNEL_EXIT_EVENT = "remote://tunnel-exit";

export type TunnelExit = {
  environmentId: string;
  exitCode?: number | null;
  stderr: string;
};

/** Feeds each dropped tunnel into the machine's connection state at once, so
 * the banner shows and recovery starts without waiting for a request to fail.
 * Returns a function that stops listening. */
export function watchTunnelExits(
  subscribe?: (handler: (event: { payload: TunnelExit }) => void) => Promise<UnlistenFn>,
): () => void {
  // Outside the desktop app (browser, tests) listening fails, which is ignored.
  const listenTo = subscribe ?? ((handler) => listen<TunnelExit>(TUNNEL_EXIT_EVENT, handler));
  let stopped = false;
  let unlisten: UnlistenFn | undefined;
  void listenTo(({ payload }) => {
    if (!payload?.environmentId) return;
    applyRemoteConnection(payload.environmentId, {
      type: "tunnel-exit",
      exitCode: payload.exitCode,
      stderr: payload.stderr ?? "",
      at: Date.now(),
    });
  })
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch(() => {});
  return () => {
    stopped = true;
    unlisten?.();
  };
}
