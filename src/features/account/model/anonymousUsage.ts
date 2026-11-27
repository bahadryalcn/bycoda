import { invoke } from "@tauri-apps/api/core";
import { AnonymousUsage, createAccountClient } from "@bycoda/account-contracts";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { utcDay } from "../../../shared/lib/time/timestamps";
import { createUsagePricing, fetchModelPrices } from "../../providers/public/providerUsage";
import { meteredTurnUsage, type UsageTurnReport } from "../../usage/public/usageAnalytics";
import { isAccountMockMode } from "./accountClient";
import type { AccountNative } from "./accountNative";
import { installationId } from "./accountPrivacy";
import { dataTransfers, jsonSharingFile, sharingMode, type SharingMode } from "../../data-sharing";

const DAY_MS = 86_400_000;
const RETRY_MS = 10 * 60_000;
const sharing = createStoredSetting({
  key: "bycoda.account.anonymousUsage.since",
  fallback: 0,
  event: "bycoda:anonymous-usage-change",
  storageEvents: true,
  parse(value) {
    const since = Number(value);
    return Number.isSafeInteger(since) && since > 0 ? since : 0;
  },
  serialize: String,
});

export const subscribeAnonymousUsage = sharing.subscribe;
export const isAnonymousUsageEnabled = () => sharing.load() > 0;
const tokensMode = sharingMode("tokens", "ask");
export const getTokensMode = (): SharingMode =>
  isAnonymousUsageEnabled() ? tokensMode.load() : "off";
export function subscribeTokensMode(listener: () => void) {
  const stop = tokensMode.subscribe(listener);
  const stopSharing = sharing.subscribe(listener);
  return () => {
    stop();
    stopSharing();
  };
}
export function setTokensMode(mode: SharingMode): boolean {
  if (!tokensMode.save(mode)) return false;
  setAnonymousUsageEnabled(mode !== "off");
  return true;
}
const tokensPermission = { load: getTokensMode, save: setTokensMode };

export function setAnonymousUsageEnabled(enabled: boolean): void {
  if (enabled !== isAnonymousUsageEnabled()) sharing.save(enabled ? Date.now() : 0);
}

export function summarizeAnonymousUsage(
  report: UsageTurnReport,
  start: number,
  end: number,
  pricing: ReturnType<typeof createUsagePricing>,
): AnonymousUsage["days"] {
  const days = new Map<string, AnonymousUsage["days"][number]>();
  for (const turn of report.turns) {
    if (turn.durationMs == null || turn.durationMs < 0 || turn.startedAt < start) continue;
    const finish = turn.startedAt + turn.durationMs;
    if (finish >= end) continue;
    const usage = meteredTurnUsage(turn, pricing);
    if (!usage) continue;
    const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    if (tokens === 0) continue;
    const date = utcDay(finish);
    if (!date) continue;
    const day = days.get(date) ?? {
      date,
      tokens: 0,
      estimatedUsdMicros: 0,
      pricedTurns: 0,
      unpricedTurns: 0,
    };
    day.tokens += tokens;
    if (usage.cost === null) day.unpricedTurns++;
    else {
      day.pricedTurns++;
      day.estimatedUsdMicros += usage.cost * 1_000_000;
    }
    days.set(date, day);
  }
  return Array.from(days.values(), (day) => ({
    ...day,
    estimatedUsdMicros: Math.round(day.estimatedUsdMicros),
  }));
}

async function sendCompletedDays(
  native: Pick<AccountNative, "status">,
  since: number,
  end: number,
  signal: AbortSignal,
  review: boolean,
): Promise<boolean> {
  const status = await native.status();
  if (!status.configured || !status.apiBaseUrl || signal.aborted) return false;
  const installId = installationId();
  if (!installId) return false;
  const start = Math.max(since, end - 7 * DAY_MS);
  const report = await invoke<UsageTurnReport>("session_usage_report", {
    sinceMs: start,
    untilMs: end,
  });
  if (report.truncated || signal.aborted) return false;
  const prices = report.turns.length > 0 ? await fetchModelPrices() : null;
  const days = summarizeAnonymousUsage(report, start, end, createUsagePricing(prices?.models));
  if (sharing.load() !== since || signal.aborted) return false;
  if (days.length === 0) return true;
  const body = AnonymousUsage.safeParse({ installId, days });
  if (!body.success) return false;
  const client = createAccountClient({
    baseUrl: status.apiBaseUrl,
    getAccessToken: async () => null,
    fetch: (input, init) =>
      globalThis.fetch(input, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      }),
  });
  const send = () => client.anonymousUsage({ body: body.data }, { signal });
  if (review)
    return dataTransfers.run(
      {
        kind: "tokens",
        destination: status.apiBaseUrl.replace(/\/+$/, "") + "/v1/anonymous/usage",
        linkedToAccount: false,
        files: [jsonSharingFile("anonymous-usage.json", body.data)],
      },
      tokensPermission,
      send,
      signal,
    );
  await send();
  return true;
}

/** Sample completed UTC days on launch and day rollover. The server deduplicates retries. */
export function startAnonymousUsage(
  native: Pick<AccountNative, "status">,
  review = false,
): () => void {
  if (isAccountMockMode()) return () => undefined;
  let completed = "";
  let running: AbortController | undefined;
  const tick = () => {
    const since = sharing.load();
    const end = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const key = `${since}:${end}`;
    if (!since || since >= end || completed === key || running) return;
    const request = new AbortController();
    running = request;
    void sendCompletedDays(native, since, end, request.signal, review)
      .then((sent) => {
        if (sent) completed = key;
      })
      .catch(() => undefined)
      .finally(() => {
        if (running === request) running = undefined;
      });
  };
  const unsubscribe = subscribeAnonymousUsage(() => {
    running?.abort();
    running = undefined;
    tick();
  });
  const startup = setTimeout(tick, 20_000);
  const timer = setInterval(tick, RETRY_MS);
  return () => {
    running?.abort();
    clearTimeout(startup);
    clearInterval(timer);
    unsubscribe();
  };
}
