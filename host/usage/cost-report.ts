import {
  createUsagePricing,
  rowCost,
  rowTokens,
  type ModelPrice,
  type UsagePricing,
} from "../../src/features/providers/model/usagePricing";
import type { LogRequest, Provider } from "./cost-scan";

/** Aggregates log requests into the totals, breakdowns and per-day trend `usage.cost.read` serves. */

export type CostParams = { days: number; utcOffsetMinutes: number };
export type CostLine = { costUsd: number; tokens: number };
export type CostReport = {
  environmentId: string;
  sampledAt: number;
  window: { startMs: number; endMs: number; days: number; utcOffsetMinutes: number };
  totals: CostLine & { activeDays: number };
  providers: ({ provider: Provider } & CostLine)[];
  models: ({ provider: Provider; model: string; priced: boolean } & CostLine)[];
  projects: ({ label: string } & CostLine)[];
  /** One bucket per local calendar day, oldest first. */
  daily: ({ date: string } & CostLine)[];
  coverage: {
    source: "host-provider-logs";
    pricing: "list-prices" | "built-in";
    filesScanned: number;
    truncated: boolean;
    unpricedModels: string[];
  };
};

const DAY_MS = 86_400_000;
export const MAX_COST_DAYS = 90;
const MAX_PROJECTS = 15;
const MAX_MODELS = 30;

export function costParams(value: unknown): CostParams {
  const source = value === undefined || value === null ? {} : value;
  if (typeof source !== "object" || Array.isArray(source))
    throw new Error("Invalid usage cost request");
  const { days = 30, utcOffsetMinutes = 0 } = source as Record<string, unknown>;
  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > MAX_COST_DAYS ||
    typeof utcOffsetMinutes !== "number" ||
    !Number.isInteger(utcOffsetMinutes) ||
    Math.abs(utcOffsetMinutes) > 14 * 60
  )
    throw new Error("Invalid usage cost window");
  return { days, utcOffsetMinutes };
}

const dayIndex = (ms: number, offsetMinutes: number) =>
  Math.floor((ms + offsetMinutes * 60_000) / DAY_MS);
// ast-grep-ignore: ts-date-toisostring-unguarded -- index is a finite day number from dayIndex, so the date is always valid
const dayKey = (index: number) => new Date(index * DAY_MS).toISOString().slice(0, 10);
const projectLabel = (path: string) =>
  path
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? "";

/** The first local day in range, as UTC ms. */
export function windowStart(now: number, params: CostParams): number {
  return (
    (dayIndex(now, params.utcOffsetMinutes) - params.days + 1) * DAY_MS -
    params.utcOffsetMinutes * 60_000
  );
}

const add = (line: CostLine, cost: number | null, tokens: number) => {
  line.costUsd += cost ?? 0;
  line.tokens += tokens;
};
const byCost = (a: CostLine, b: CostLine) => b.costUsd - a.costUsd || b.tokens - a.tokens;
const money = (value: number) => Math.round(value * 1e6) / 1e6;

export function aggregateCost(
  requests: { provider: Provider; request: LogRequest }[],
  now: number,
  params: CostParams,
  pricing: UsagePricing,
  meta: Pick<CostReport["coverage"], "pricing" | "filesScanned" | "truncated"> & {
    environmentId: string;
  },
): CostReport {
  const startMs = windowStart(now, params);
  const today = dayIndex(now, params.utcOffsetMinutes);
  const daily = Array.from({ length: params.days }, (_, offset) => ({
    date: dayKey(today - params.days + 1 + offset),
    costUsd: 0,
    tokens: 0,
  }));
  const providers = new Map<Provider, CostLine & { provider: Provider }>();
  const models = new Map<
    string,
    CostLine & { provider: Provider; model: string; priced: boolean }
  >();
  const projects = new Map<string, CostLine & { label: string }>();
  const unpriced = new Set<string>();
  for (const { provider, request } of requests) {
    const ms = request.ts * 1000;
    const bucket = daily[dayIndex(ms, params.utcOffsetMinutes) - (today - params.days + 1)];
    if (!bucket || ms < startMs) continue;
    const row = { ...request, slot: request.ts };
    const cost = rowCost(row, pricing);
    const tokens = rowTokens(row);
    if (cost === null) unpriced.add(request.model);
    add(bucket, cost, tokens);
    add(
      providers.get(provider) ??
        providers.set(provider, { provider, costUsd: 0, tokens: 0 }).get(provider)!,
      cost,
      tokens,
    );
    const modelKey = `${provider}:${request.model}`;
    const model =
      models.get(modelKey) ??
      models
        .set(modelKey, {
          provider,
          model: request.model,
          priced: cost !== null,
          costUsd: 0,
          tokens: 0,
        })
        .get(modelKey)!;
    add(model, cost, tokens);
    // Paths stay on the Host; only the folder name leaves it.
    const label = projectLabel(request.project);
    add(
      projects.get(label) ?? projects.set(label, { label, costUsd: 0, tokens: 0 }).get(label)!,
      cost,
      tokens,
    );
  }
  const round = <T extends CostLine>(line: T): T => ({ ...line, costUsd: money(line.costUsd) });
  return {
    environmentId: meta.environmentId,
    sampledAt: now,
    window: { startMs, endMs: now, days: params.days, utcOffsetMinutes: params.utcOffsetMinutes },
    totals: {
      costUsd: money(daily.reduce((sum, day) => sum + day.costUsd, 0)),
      tokens: daily.reduce((sum, day) => sum + day.tokens, 0),
      activeDays: daily.filter((day) => day.tokens > 0).length,
    },
    providers: [...providers.values()].sort(byCost).map(round),
    models: [...models.values()].sort(byCost).slice(0, MAX_MODELS).map(round),
    projects: [...projects.values()].sort(byCost).slice(0, MAX_PROJECTS).map(round),
    daily: daily.map(round),
    coverage: {
      source: "host-provider-logs",
      pricing: meta.pricing,
      filesScanned: meta.filesScanned,
      truncated: meta.truncated,
      unpricedModels: [...unpriced].sort(),
    },
  };
}

// The OpenRouter list is public; nothing about local usage is sent. Cached for a day like the desktop.
const PRICES_URL = "https://openrouter.ai/api/v1/models";
const PRICES_TTL_MS = 86_400_000;
let prices: { at: number; models: ModelPrice[] } | null = null;

async function listPrices(now: number): Promise<ModelPrice[] | null> {
  if (prices && now - prices.at < PRICES_TTL_MS) return prices.models;
  try {
    const response = await fetch(PRICES_URL, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("price list unavailable");
    const body = (await response.json()) as { data?: unknown };
    const price = (value: unknown): number | null => {
      const parsed =
        typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const models: ModelPrice[] = [];
    for (const item of Array.isArray(body.data) ? body.data : []) {
      const id = item?.id;
      const pricing = item?.pricing;
      if (typeof id !== "string" || id.includes(":") || !pricing) continue;
      if (!id.startsWith("anthropic/") && !id.startsWith("openai/")) continue;
      const input = price(pricing.prompt);
      const output = price(pricing.completion);
      if (input === null || output === null) continue;
      models.push({
        id,
        input,
        output,
        cacheRead: price(pricing.input_cache_read),
        cacheWrite: price(pricing.input_cache_write),
        cacheWrite1h: price(pricing.input_cache_write_1h),
      });
    }
    if (!models.length) throw new Error("empty price list");
    prices = { at: now, models };
    return models;
  } catch {
    // A stale list beats none; otherwise the built-in table prices the report.
    return prices?.models ?? null;
  }
}

export async function loadPricing(now: number) {
  const models = await listPrices(now);
  return {
    pricing: createUsagePricing(models ?? []),
    source: models ? ("list-prices" as const) : ("built-in" as const),
  };
}
