// Pure usage pricing shared by the desktop and the Host; no Tauri imports.
/** One 15-minute bucket of token counts for a model and working directory. */
export type UsageRow = {
  /** Bucket start, Unix seconds. */
  slot: number;
  model: string;
  /** Working directory the session ran in; empty when unknown. */
  project: string;
  /** Uncached input tokens. */
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
};


/** US dollars per million tokens. */
type Rate = {
  input: number;
  output: number;
  cacheRead: number;
  /** Anthropic bills cache writes; OpenAI does not. */
  cacheWrite5m?: number;
  cacheWrite1h?: number;
};

const anthropic = (input: number, output: number, cacheRead: number): Rate => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
});

const openai = (input: number, output: number, cacheRead: number): Rate => ({
  input,
  output,
  cacheRead,
});

/**
 * Standard pay-as-you-go API rates, matched by model id prefix. Update this
 * table when providers change prices or release models; unknown models are
 * counted in tokens but left out of cost.
 */
const RATES: Record<string, Rate> = {
  "claude-fable-5-1": anthropic(10, 50, 0.25),
  "claude-mythos-5-1": anthropic(10, 50, 0.25),
  "claude-fable-5": anthropic(10, 50, 1),
  "claude-mythos-5": anthropic(10, 50, 1),
  "claude-opus-5-5": anthropic(4, 20, 0.2),
  "claude-opus-5": anthropic(5, 25, 0.5),
  "claude-opus-4-8": anthropic(5, 25, 0.5),
  "claude-opus-4-7": anthropic(5, 25, 0.5),
  "claude-opus-4-6": anthropic(5, 25, 0.5),
  "claude-opus-4-5": anthropic(5, 25, 0.5),
  "claude-opus-4-1": anthropic(15, 75, 1.5),
  "claude-opus-4": anthropic(15, 75, 1.5),
  "claude-sonnet-5-5": anthropic(2, 10, 0.2),
  "claude-sonnet-5": anthropic(2, 10, 0.2),
  "claude-sonnet-4-6": anthropic(3, 15, 0.3),
  "claude-sonnet-4-5": anthropic(3, 15, 0.3),
  "claude-sonnet-4": anthropic(3, 15, 0.3),
  "claude-3-7-sonnet": anthropic(3, 15, 0.3),
  "claude-haiku-4-5": anthropic(1, 5, 0.1),
  "claude-3-5-haiku": anthropic(0.8, 4, 0.08),
  "gpt-5.6-sol": openai(5, 30, 0.5),
  "gpt-5.6-terra": openai(2, 12, 0.2),
  "gpt-5.6-luna": openai(0.2, 1.2, 0.02),
  "gpt-5.5-pro": openai(30, 180, 30),
  "gpt-5.5": openai(5, 30, 0.5),
  "gpt-5.4-pro": openai(30, 180, 30),
  "gpt-5.4-mini": openai(0.75, 4.5, 0.075),
  "gpt-5.4-nano": openai(0.2, 1.25, 0.02),
  "gpt-5.4": openai(2.5, 15, 0.25),
  "gpt-5.3": openai(1.75, 14, 0.175),
  "gpt-5.2": openai(1.75, 14, 0.175),
  "gpt-5.1-codex-mini": openai(0.25, 2, 0.025),
  "gpt-5.1": openai(1.25, 10, 0.125),
  "gpt-5-codex-mini": openai(0.25, 2, 0.025),
  "gpt-5-mini": openai(0.25, 2, 0.025),
  "gpt-5-nano": openai(0.05, 0.4, 0.005),
  "gpt-5": openai(1.25, 10, 0.125),
};

function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(anthropic|openai)[/.]/, "");
}

/** Length of `key` when it names `id` or a dated/suffixed variant of it. */
function prefixMatch(id: string, key: string): number {
  return id === key || (id.startsWith(key) && /[-@]/.test(id[key.length])) ? key.length : -1;
}

function bestRate(id: string, table: Record<string, Rate>): { rate: Rate; length: number } | null {
  let best: { rate: Rate; length: number } | null = null;
  for (const [key, rate] of Object.entries(table)) {
    const length = prefixMatch(id, key);
    if (length > (best?.length ?? -1)) best = { rate, length };
  }
  return best;
}

/** Built-in rate for a model id such as `claude-sonnet-4-5-20250929` or `gpt-5.5-codex`. */
export function usageRate(model: string): Rate | null {
  return bestRate(normalizeModelId(model), RATES)?.rate ?? null;
}

/** Looks up the rate for a model id as it appears in the session logs. */
export type UsagePricing = (model: string) => Rate | null;

/** One model's list price in dollars per token, from OpenRouter. */
export type ModelPrice = {
  id: string;
  input: number;
  output: number;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  cacheWrite1h?: number | null;
};

/**
 * Prices from OpenRouter where it lists the model, the built-in table
 * otherwise. The more specific match wins, so a dated Claude id is not
 * priced as its family when only the built-in table knows the exact model.
 */
export function createUsagePricing(models: ModelPrice[] = []): UsagePricing {
  const remote: Record<string, Rate> = {};
  for (const model of models) {
    const perMillion = (value: number) => value * 1_000_000;
    const input = perMillion(model.input);
    if (model.id.startsWith("anthropic/")) {
      // Claude Code logs dashed ids (claude-opus-5-5); OpenRouter uses dots.
      remote[normalizeModelId(model.id).replace(/\./g, "-")] = {
        input,
        output: perMillion(model.output),
        cacheRead: model.cacheRead != null ? perMillion(model.cacheRead) : input * 0.1,
        cacheWrite5m: model.cacheWrite != null ? perMillion(model.cacheWrite) : input * 1.25,
        cacheWrite1h: model.cacheWrite1h != null ? perMillion(model.cacheWrite1h) : input * 2,
      };
    } else if (model.id.startsWith("openai/")) {
      const id = normalizeModelId(model.id);
      remote[id] = {
        input,
        output: perMillion(model.output),
        // Without a listed cache price, keep the built-in discount for this
        // model rather than billing cache reads as full input.
        cacheRead:
          model.cacheRead != null
            ? perMillion(model.cacheRead)
            : (usageRate(id)?.cacheRead ?? input),
      };
    }
  }
  return (model) => {
    const id = normalizeModelId(model);
    const fromRemote = bestRate(id, remote);
    const builtIn = bestRate(id, RATES);
    if (!fromRemote) return builtIn?.rate ?? null;
    if (!builtIn) return fromRemote.rate;
    return fromRemote.length >= builtIn.length ? fromRemote.rate : builtIn.rate;
  };
}

export function rowTokens(row: UsageRow): number {
  return rowInput(row) + row.output;
}

/** Every input token, cached or not. */
export function rowInput(row: UsageRow): number {
  return row.input + row.cacheRead + row.cacheWrite5m + row.cacheWrite1h;
}

/** Estimated cost in dollars, or null when the model has no known rate. */
export function rowCost(row: UsageRow, pricing: UsagePricing = usageRate): number | null {
  const rate = pricing(row.model);
  if (!rate) return null;
  return (
    (row.input * rate.input +
      row.cacheRead * rate.cacheRead +
      row.cacheWrite5m * (rate.cacheWrite5m ?? rate.input) +
      row.cacheWrite1h * (rate.cacheWrite1h ?? rate.input) +
      row.output * rate.output) /
    1_000_000
  );
}
