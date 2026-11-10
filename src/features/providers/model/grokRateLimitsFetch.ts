import { homeDir } from "../../../platform/tauri/fs";
import {
  createChildProcessHandle,
  killChild,
  resolveGrokBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../../integrations/harness/core/child";
import { JsonRpcClient } from "../../../integrations/harness/core/jsonRpc";
import { createProviderRetirementLedger } from "../../../integrations/harness/core/providerRetirement";
import { grokSpawnArgs } from "../../../integrations/harness/providers/grok/grokProtocol";
import {
  clampUsedPercent,
  errorRateLimits,
  idleRateLimits,
  MONTHLY_WINDOW_MINUTES,
  unavailableRateLimits,
  WEEKLY_WINDOW_MINUTES,
  type ProviderRateLimits,
} from "./rateLimits";

const REQUEST_TIMEOUT_MS = 12_000;
const retirements = createProviderRetirementLedger("grok.usage", killChild);
let inflight: Promise<ProviderRateLimits> | undefined;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const timestamp = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Grok's authenticated ACP billing extension reports account credits, not tokens. */
export function parseGrokBilling(value: unknown): ProviderRateLimits {
  const config = record(record(value)?.config);
  const period = record(config?.currentPeriod);
  const used = config?.creditUsagePercent;
  const windowKey =
    period?.type === "USAGE_PERIOD_TYPE_WEEKLY"
      ? "weekly"
      : period?.type === "USAGE_PERIOD_TYPE_MONTHLY"
        ? "monthly"
        : null;
  if (typeof used !== "number" || !Number.isFinite(used) || !windowKey)
    return errorRateLimits("grok", "Grok usage response was unexpected");
  const start = timestamp(period?.start);
  const end = timestamp(period?.end);
  const duration = start !== null && end !== null && end > start ? (end - start) / 60_000 : null;
  return {
    ...idleRateLimits("grok"),
    status: "ok",
    updatedAt: Date.now(),
    [windowKey]: {
      usedPercent: clampUsedPercent(used),
      windowMinutes:
        duration ?? (windowKey === "weekly" ? WEEKLY_WINDOW_MINUTES : MONTHLY_WINDOW_MINUTES),
      resetsAt: end,
    },
  };
}

/** Coalesce footer/history reads; the CLI retains ownership of cached authentication. */
export function fetchGrokRateLimits(): Promise<ProviderRateLimits> {
  if (!inflight) {
    inflight = readGrokRateLimits().finally(() => {
      inflight = undefined;
    });
  }
  return inflight;
}

async function readGrokRateLimits(): Promise<ProviderRateLimits> {
  try {
    await retirements.drain();
    const { path } = await resolveGrokBinary();
    const cwd = await homeDir();
    const handle = retirements.admit(
      createChildProcessHandle(`bycoda-grok-usage-${crypto.randomUUID()}`, undefined, "management"),
      "grok.usage",
    );
    const rpc = new JsonRpcClient(
      handle,
      {
        onRequest: (id) =>
          rpc.respondError(id, { code: -32601, message: "Unsupported usage probe request" }),
      },
      { includeJsonrpc: true, label: "grok-usage" },
    );
    watchChild(
      handle,
      (line) => rpc.pushLine(line),
      () => rpc.close(new Error("Grok usage probe exited")),
    );
    try {
      await spawnChild(handle, path, grokSpawnArgs({ model: "" }), cwd, undefined, "grok");
      const init = record(
        await rpc.request(
          "initialize",
          {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "bycoda", version: "0.1.0" },
          },
          REQUEST_TIMEOUT_MS,
        ),
      );
      const methods = Array.isArray(init?.authMethods) ? init.authMethods : [];
      // API-key accounts have no subscription allowance; never trigger browser login.
      if (!methods.some((method) => record(method)?.id === "cached_token"))
        return unavailableRateLimits("grok", "Grok usage requires a Grok account sign-in");
      await rpc.request(
        "authenticate",
        { methodId: "cached_token", _meta: { headless: true } },
        REQUEST_TIMEOUT_MS,
      );
      return parseGrokBilling(await rpc.request("_x.ai/billing", {}, REQUEST_TIMEOUT_MS));
    } finally {
      rpc.close();
      unwatchChild(handle);
      await retirements.retire([handle]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not authenticated|authentication required|not signed in|no cached|ENOENT|not found/i.test(
        message,
      )
    )
      return unavailableRateLimits("grok", message);
    return errorRateLimits("grok", message);
  }
}
