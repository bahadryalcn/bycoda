import { t } from "../../../shared/i18n/core";
import type { HarnessEvent } from "./types";

/**
 * How long a provider process may take to answer its startup handshake
 * (initialize) before an interactive turn gives up. A cold start after an
 * install, a Host restart or with many plugins/MCP servers can be slow.
 */
export const PROVIDER_STARTUP_TIMEOUT_MS = 30_000;
/** A start slower than this shows a "Starting <provider>…" row instead of silence. */
const PROVIDER_STARTUP_NOTICE_DELAY_MS = 5_000;
const PROVIDER_STARTUP_STATUS_KEY = "provider-starting";

/**
 * Shows "Starting <provider>…" when the startup handshake takes longer than a
 * few seconds. The returned function clears the row; call it once the session
 * started or the start failed (it is safe to call repeatedly).
 */
export function announceSlowProviderStartup(
  onEvent: (event: HarnessEvent) => void,
  provider: string,
): () => void {
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    onEvent({
      type: "status",
      key: PROVIDER_STARTUP_STATUS_KEY,
      text: t("Starting {p0}…", { p0: provider }),
    });
  }, PROVIDER_STARTUP_NOTICE_DELAY_MS);
  return () => {
    clearTimeout(timer);
    if (!shown) return;
    shown = false;
    onEvent({ type: "status", key: PROVIDER_STARTUP_STATUS_KEY, text: "" });
  };
}

/** Runs a provider start under the slow-start notice and clears it either way. */
export async function withSlowStartupNotice<T>(
  onEvent: (event: HarnessEvent) => void,
  provider: string,
  start: () => Promise<T>,
): Promise<T> {
  const done = announceSlowProviderStartup(onEvent, provider);
  try {
    return await start();
  } finally {
    done();
  }
}
