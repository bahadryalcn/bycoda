import { AnonymousPing, createAccountClient } from "@bycoda/account-contracts";
import { isAccountMockMode } from "./accountClient";
import type { AccountNative } from "./accountNative";
import { dataTransfers, jsonSharingFile, sharingMode, type SharingMode } from "../../data-sharing";
import {
  getLastPingDate,
  getStatsChoice,
  installationId,
  setLastPingDate,
  setAnonymousStatsEnabled,
  subscribeAnonymousStats,
} from "./accountPrivacy";

export type PingResult = "sent" | "skipped" | "failed";
export type PingDeps = {
  native: Pick<AccountNative, "status" | "deviceInfo">;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  review?: boolean;
  signal?: AbortSignal;
};

const statisticsMode = sharingMode("statistics", "ask");
export const getStatisticsMode = (): SharingMode =>
  getStatsChoice() === "on" ? (statisticsMode.load() === "auto" ? "auto" : "ask") : "off";
export const subscribeStatisticsMode = subscribeAnonymousStats;
export function setStatisticsMode(mode: SharingMode): boolean {
  if (!statisticsMode.save(mode)) return false;
  setAnonymousStatsEnabled(mode !== "off");
  return true;
}
const statisticsPermission = { load: getStatisticsMode, save: setStatisticsMode };

/** The local calendar day, `YYYY-MM-DD`. */
export function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Sends today's signal when the user said yes, it was not sent today and the API address is
 * configured. The body is the contract's strict `AnonymousPing`: nothing else can be added.
 * No token is requested and no device header is attached; every failure is silent.
 */
export async function sendDailyPing(deps: PingDeps): Promise<PingResult> {
  try {
    if (getStatsChoice() !== "on") return "skipped";
    const date = localDay((deps.now ?? (() => new Date()))());
    if (getLastPingDate() === date) return "skipped";
    const status = await deps.native.status();
    if (!status.configured || !status.apiBaseUrl) return "skipped";
    const installId = installationId();
    if (!installId) return "skipped";
    const device = await deps.native.deviceInfo();
    const ping = AnonymousPing.safeParse({
      installId,
      appVersion: device.appVersion,
      platform: device.platform,
      osVersion: device.osVersion,
      channel: device.channel,
      date,
    });
    if (!ping.success) return "skipped";
    // Turning it off while the lookups ran stops the send.
    if (getStatsChoice() !== "on") return "skipped";
    const client = createAccountClient({
      baseUrl: status.apiBaseUrl,
      getAccessToken: async () => null,
      fetch: deps.fetchImpl,
    });
    const send = () => client.anonymousPing({ body: ping.data }, { signal: deps.signal });
    if (deps.review) {
      const sent = await dataTransfers.run(
        {
          kind: "statistics",
          destination: status.apiBaseUrl.replace(/\/+$/, "") + "/v1/anonymous/ping",
          linkedToAccount: false,
          files: [jsonSharingFile("anonymous-ping.json", ping.data)],
        },
        statisticsPermission,
        send,
        deps.signal,
      );
      if (!sent) return "skipped";
    } else await client.anonymousPing({ body: ping.data });
    setLastPingDate(date);
    return "sent";
  } catch {
    return "failed"; // -- silent by design; the next start or day change tries again.
  }
}

const DAY_CHECK_MS = 10 * 60_000;

/**
 * Sends at start, when the choice becomes yes and when the local day changes. A day is tried
 * once per window: a failure waits for the next start or the next day.
 */
export function startAnonymousStats(deps: PingDeps): () => void {
  if (isAccountMockMode()) return () => undefined;
  const now = deps.now ?? (() => new Date());
  let attempted: string | null = null;
  let running = false;
  const lifetime = new AbortController();
  const tick = () => {
    const day = localDay(now());
    if (running || attempted === day || getStatsChoice() !== "on") return;
    attempted = day;
    running = true;
    void sendDailyPing({ ...deps, signal: lifetime.signal }).finally(() => {
      running = false;
    });
  };
  tick();
  const timer = setInterval(tick, DAY_CHECK_MS);
  const unsubscribe = subscribeAnonymousStats(tick);
  return () => {
    lifetime.abort();
    clearInterval(timer);
    unsubscribe();
  };
}
