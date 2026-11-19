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
 * The list only ever comes from the Host's own Tailscale status (`read` and `observe`),
 * never from a request, so an unknown Host header stays rejected. The probe runs the
 * Tailscale CLI, so it refreshes in the background and the synchronous upgrade check
 * reads the last known value. `refresh()` re-probes now (Host listening, Serve enabled);
 * `observe()` takes any status the Host already read, so an enable is visible at once.
 */
export function createTailnetServeHosts(read: () => Promise<MobileAccessStatus>) {
  let hosts: readonly string[] = [];
  let pending = false;
  let again = false;
  // Bumped by every observed status, so a slower probe that started earlier cannot
  // overwrite a newer answer (an enable finishing while an old probe is still running).
  let generation = 0;
  const apply = (status: MobileAccessStatus) => {
    // `status()` reports a CLI failure as `unavailable` rather than throwing. Only a
    // definite answer replaces the list; anything else keeps the last known name.
    if (status.state === "ready") {
      const host = tailnetServeHost(status);
      hosts = host ? [host] : [];
    } else if (status.state === "setup-required" || status.state === "install-required") hosts = [];
  };
  const refresh = () => {
    if (pending) {
      // The running probe may have started before the reason for this call (the Host
      // began listening), so it must run once more instead of being dropped.
      again = true;
      return;
    }
    pending = true;
    const started = generation;
    void read()
      .then((status) => {
        if (generation === started) apply(status);
      })
      .catch(() => {
        /* Keep the last known name; a failed probe is not proof Serve stopped. */
      })
      .finally(() => {
        pending = false;
        if (again) {
          again = false;
          refresh();
        }
      });
  };
  const observe = (status: MobileAccessStatus) => {
    generation++;
    apply(status);
  };
  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  timer.unref?.();
  return {
    current: () => hosts,
    refresh,
    observe,
    dispose: () => clearInterval(timer),
  };
}
