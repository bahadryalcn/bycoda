import { createHash } from "node:crypto";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import type { SecretValueStore } from "../secrets/secret-store";
import {
  AdapterFailure,
  type AdapterCall,
  type AdapterFailureCode,
  type AdapterLimits,
  type AdapterTransport,
  type ContractAdapter,
  type ParsedAnswer,
  assertValidRequest,
  fitsLimits,
  planChunks,
} from "./contract-adapters/common";
import { createFetchTransport } from "./contract-adapters/http";
import { customAdapter } from "./contract-adapters/custom";
import { decisionsAdapter } from "./contract-adapters/decisions";
import { llmStructuredAdapter } from "./contract-adapters/llm-structured";
import { ollamaSystemOneAdapter } from "./contract-adapters/ollama-systemone";
import { systemOneAdapter } from "./contract-adapters/systemone";
import { EVALUATION_SET, evaluationAccuracy } from "./evaluation";
import { planRoute } from "./router";
import {
  DEFAULT_THRESHOLD,
  type DecisionAnswer,
  type DecisionConfig,
  type DecisionEvaluation,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionResult,
  type DecisionSource,
  type DecisionSourceTest,
  type DecisionTaskType,
} from "./decision-types";

export type DecisionGatewayDeps = {
  loadConfig: () => Promise<DecisionConfig>;
  /** Reads API keys from the vault by secretRef. Without it, sources that need a key are unavailable. */
  secrets?: Pick<SecretValueStore, "get">;
  /** Text runner for the llm-structured adapter. Without it, that adapter is unavailable. */
  runTextPrompt?: AdapterTransport["runTextPrompt"];
  fetcher?: typeof fetch;
  /**
   * Loopback address of a local source that has no endpoint of its own (its runtime's port is
   * chosen at start). Undefined means the source is unavailable for this call.
   */
  resolveEndpoint?: (source: DecisionSource) => Promise<string | undefined>;
  /** Called after a local source answers, so an idle runtime can stop later. */
  touchLocal?: (sourceId: string) => void;
  /** Wall clock for cache expiry and audit timestamps. */
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type DecisionAuditEntry = {
  at: number;
  taskType: DecisionTaskType;
  sourceId: string;
  adapter: DecisionSource["adapter"];
  model?: string;
  outcome: "answered" | "unavailable" | "skipped";
  /** Questions that were answered and questions that were answered at or above the threshold. */
  answered: number;
  aboveThreshold: number;
  cached: number;
  durationMs: number;
  confidences: number[];
  errorCode?: AdapterFailureCode | "missing_key" | "limit";
  inputTokens?: number;
  estimatedCostUsd?: number;
};

export type DecisionGateway = {
  decide(request: DecisionRequest): Promise<DecisionResult>;
  test(sourceId: string): Promise<DecisionSourceTest>;
  evaluate(sourceId: string): Promise<DecisionEvaluation>;
  /** Most recent audit entries, oldest first. They hold no question text, state or answer content. */
  recentAudit(): DecisionAuditEntry[];
};

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [250, 1000];
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 256;
const AUDIT_MAX_ENTRIES = 200;

const ADAPTERS: Record<DecisionSource["adapter"], ContractAdapter> = {
  systemone: systemOneAdapter,
  decisions: decisionsAdapter,
  "ollama-systemone": ollamaSystemOneAdapter,
  "llm-structured": llmStructuredAdapter,
  custom: customAdapter,
};

/** Cache key for one question on one source. The state is part of the key, so the cache holds no answers for other inputs. */
function cacheKey(
  taskType: DecisionTaskType,
  state: Record<string, unknown>,
  name: string,
  question: DecisionQuestion,
  source: DecisionSource,
): string {
  const material = JSON.stringify({
    taskType,
    state,
    name,
    question,
    sourceId: source.id,
    adapter: source.adapter,
    model: source.model ?? null,
  });
  return createHash("sha256").update(material).digest("hex");
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(
        new AdapterFailure("timeout", "The decision request timed out.", { retryable: false }),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/** Adapter errors that are not AdapterFailure become one generic failure, so no message from the provider leaks. */
function asFailure(error: unknown): AdapterFailure {
  if (error instanceof AdapterFailure) return error;
  return new AdapterFailure("unavailable", "The decision source failed.", { retryable: false });
}

export function createDecisionGateway(deps: DecisionGatewayDeps): DecisionGateway {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const transport = createFetchTransport({
    fetcher: deps.fetcher,
    runTextPrompt: deps.runTextPrompt,
  });
  const cache = new AnswerCache(now);
  const audit: DecisionAuditEntry[] = [];

  function record(entry: DecisionAuditEntry): void {
    audit.push(entry);
    if (audit.length > AUDIT_MAX_ENTRIES) audit.splice(0, audit.length - AUDIT_MAX_ENTRIES);
  }

  /** Retries transient failures with a fixed backoff, inside the same deadline. */
  async function callAdapter(adapter: ContractAdapter, call: AdapterCall) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await adapter.run(call);
      } catch (error) {
        const failure = asFailure(error);
        if (!failure.retryable || attempt >= RETRY_DELAYS_MS.length || call.signal.aborted)
          throw failure;
        await sleep(RETRY_DELAYS_MS[attempt], call.signal);
      }
    }
  }

  /** A local source without its own endpoint gets the address its runtime reports (starting it if needed). */
  async function resolveTarget(source: DecisionSource): Promise<DecisionSource | undefined> {
    if (source.kind !== "local" || source.endpoint || !deps.resolveEndpoint) return source;
    const endpoint = await deps.resolveEndpoint(source).catch(() => undefined);
    if (!endpoint) return undefined;
    deps.touchLocal?.(source.id);
    return { ...source, endpoint };
  }

  /**
   * Asks one source for the given questions. Returns the answers it gave (cached or fresh), without
   * threshold decisions. Writes one audit entry for the attempt.
   */
  async function runSource(
    source: DecisionSource,
    taskType: DecisionTaskType,
    state: Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
    signal: AbortSignal,
    threshold: number,
    useCache: boolean,
  ): Promise<Map<string, ParsedAnswer>> {
    const started = monotonicNow();
    const adapter = ADAPTERS[source.adapter];
    const found = new Map<string, ParsedAnswer>();
    const names = Object.keys(questions);
    const keys = new Map(
      names.map((name) => [name, cacheKey(taskType, state, name, questions[name], source)]),
    );
    const toAsk: Record<string, DecisionQuestion> = {};
    for (const name of names) {
      const hit = useCache ? cache.get(keys.get(name) ?? "") : undefined;
      if (hit) found.set(name, hit);
      else toAsk[name] = questions[name];
    }
    const cached = found.size;
    const entry = (fields: Partial<DecisionAuditEntry>): void => {
      const confidences = [...found.values()].map((answer) => answer.confidence);
      record({
        at: now(),
        taskType,
        sourceId: source.id,
        adapter: source.adapter,
        model: source.model,
        outcome: found.size > 0 ? "answered" : "unavailable",
        answered: found.size,
        aboveThreshold: confidences.filter((value) => value >= threshold).length,
        cached,
        durationMs: elapsedSince(started),
        confidences,
        ...fields,
      });
    };
    if (Object.keys(toAsk).length === 0) {
      entry({});
      return found;
    }
    const apiKey = source.secretRef ? await deps.secrets?.get(source.secretRef) : undefined;
    if (source.secretRef && !apiKey) {
      entry({ errorCode: "missing_key" });
      return found;
    }
    const limits: AdapterLimits = adapter.limits;
    const fitting: Record<string, DecisionQuestion> = {};
    for (const [name, question] of Object.entries(toAsk)) {
      if (fitsLimits(question, limits)) fitting[name] = question;
    }
    let chunks: Record<string, DecisionQuestion>[];
    try {
      chunks = planChunks(state, fitting, limits);
    } catch {
      entry({ outcome: "skipped", errorCode: "limit" });
      return found;
    }
    const target = await resolveTarget(source);
    if (!target) {
      entry({ errorCode: "unavailable" });
      return found;
    }
    let inputTokens = 0;
    let errorCode: DecisionAuditEntry["errorCode"];
    for (const chunk of chunks) {
      try {
        const output = await callAdapter(adapter, {
          source: target,
          state,
          questions: chunk,
          apiKey,
          signal,
          transport,
        });
        if (output.inputTokens !== undefined) inputTokens += output.inputTokens;
        for (const [name, answer] of Object.entries(output.answers)) {
          found.set(name, answer);
          cache.set(keys.get(name) ?? "", answer);
        }
      } catch (error) {
        errorCode = asFailure(error).code;
        break;
      }
    }
    const costPerMillion = source.costPerMTokens;
    entry({
      ...(errorCode ? { errorCode } : {}),
      ...(inputTokens > 0 ? { inputTokens } : {}),
      ...(inputTokens > 0 && costPerMillion !== undefined
        ? { estimatedCostUsd: (inputTokens / 1_000_000) * costPerMillion }
        : {}),
    });
    return found;
  }

  async function decide(request: DecisionRequest): Promise<DecisionResult> {
    assertValidRequest(request);
    const started = monotonicNow();
    const config = await deps.loadConfig();
    const plan = planRoute(config, request.taskType, request.personalData);
    const total = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = AbortSignal.timeout(total);
    const satisfied = new Map<string, DecisionAnswer>();
    const below = new Set<string>();
    const sourceChain: string[] = [];
    let pending = Object.keys(request.questions);

    for (const { source, threshold } of plan) {
      if (pending.length === 0 || deadline.aborted) break;
      sourceChain.push(source.id);
      const questions = Object.fromEntries(pending.map((name) => [name, request.questions[name]]));
      const budget = AbortSignal.any([
        deadline,
        AbortSignal.timeout(Math.max(1000, Math.ceil(total / plan.length))),
      ]);
      const found = await runSource(
        source,
        request.taskType,
        request.state,
        questions,
        budget,
        threshold,
        true,
      );
      for (const name of pending) {
        const answer = found.get(name);
        if (!answer) continue;
        if (answer.confidence >= threshold) {
          satisfied.set(name, {
            value: answer.value,
            probabilities: answer.probabilities,
            confidence: answer.confidence,
            raw: answer.raw,
            sourceId: source.id,
            model: source.model ?? source.name,
          });
        } else {
          below.add(name);
        }
      }
      pending = pending.filter((name) => !satisfied.has(name));
    }

    const answers: DecisionResult["answers"] = {};
    for (const name of Object.keys(request.questions)) {
      const answer = satisfied.get(name);
      answers[name] = answer ?? { error: below.has(name) ? "below_threshold" : "unavailable" };
    }
    return { answers, sourceChain, durationMs: elapsedSince(started) };
  }

  async function findSource(sourceId: string): Promise<DecisionSource | undefined> {
    return (await deps.loadConfig()).sources.find((source) => source.id === sourceId);
  }

  async function test(sourceId: string): Promise<DecisionSourceTest> {
    const source = await findSource(sourceId);
    if (!source) return { sourceId, ok: false, error: "unavailable" };
    const probe = EVALUATION_SET[0];
    const started = monotonicNow();
    const found = await runSource(
      source,
      "generic",
      probe.state,
      { [probe.id]: probe.question },
      AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      DEFAULT_THRESHOLD,
      false,
    );
    const ok = found.size > 0;
    return ok
      ? { sourceId, ok: true, durationMs: elapsedSince(started) }
      : { sourceId, ok: false, durationMs: elapsedSince(started), error: "unavailable" };
  }

  async function evaluate(sourceId: string): Promise<DecisionEvaluation> {
    const source = await findSource(sourceId);
    if (!source) return { sourceId, cases: 0, error: "unavailable" };
    const values: (string | number | boolean | undefined)[] = [];
    let totalMs = 0;
    let answered = 0;
    for (const testCase of EVALUATION_SET) {
      const started = monotonicNow();
      const found = await runSource(
        source,
        "generic",
        testCase.state,
        { answer: testCase.question },
        AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        DEFAULT_THRESHOLD,
        false,
      );
      totalMs += elapsedSince(started);
      const answer = found.get("answer");
      if (answer) answered += 1;
      values.push(answer && answer.confidence >= DEFAULT_THRESHOLD ? answer.value : undefined);
    }
    if (answered === 0) return { sourceId, cases: EVALUATION_SET.length, error: "unavailable" };
    return {
      sourceId,
      cases: EVALUATION_SET.length,
      accuracy: evaluationAccuracy(values),
      avgMs: Math.round(totalMs / EVALUATION_SET.length),
    };
  }

  return {
    decide,
    test,
    evaluate,
    recentAudit: () => audit.slice(),
  };
}

/** Bounded, expiring answer cache owned by one gateway instance. */
class AnswerCache {
  private readonly entries = new Map<string, { answer: ParsedAnswer; storedAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  get(key: string): ParsedAnswer | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    this.entries.delete(key);
    if (this.now() - hit.storedAt > CACHE_TTL_MS) return undefined;
    this.entries.set(key, hit);
    return hit.answer;
  }

  set(key: string, answer: ParsedAnswer): void {
    this.entries.delete(key);
    this.entries.set(key, { answer, storedAt: this.now() });
    while (this.entries.size > CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
