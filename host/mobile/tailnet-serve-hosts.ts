import type { MobileAccessStatus } from "../../src/integrations/mobile-access";

const REFRESH_MS = 60_000;

/** The exact Host header of a ready Tailscale Serve endpoint (`name.tailnet.ts.net`), else none. */
export function tailnetServeHost(status: MobileAccessStatus | undefined): string | undefined {
  if (status?.state !== "ready" || !status.endpoint) return undefined;
  try {
    const url = new URL(status.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    return url.hostname.toLowerCase().endsWith(".ts.net") ? url.host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps this Host's own Tailscale Serve name for WebSocket Host-header validation.
 * The probe runs the Tailscale CLI, so it refreshes in the background and the
 * synchronous upgrade check reads the last known value.
 */
export function createTailnetServeHosts(read: () => Promise<MobileAccessStatus>) {
  let hosts: readonly string[] = [];
  let pending = false;
  const refresh = () => {
    if (pending) return;
    pending = true;
    void read()
      .then((status) => {
        const host = tailnetServeHost(status);
        hosts = host ? [host] : [];
      })
      .catch(() => {
        /* Keep the last known name; a failed probe is not proof Serve stopped. */
      })
      .finally(() => {
        pending = false;
      });
  };
  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  timer.unref?.();
  return {
    current: () => hosts,
    dispose: () => clearInterval(timer),
  };
}
