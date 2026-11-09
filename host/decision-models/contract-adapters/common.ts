import { DECISION_TASK_TYPES } from "../../../src/shared/model/host-contracts/decision-models";
import {
  argmax,
  distributionConfidence,
  noulConfidence,
  normalizeDistribution,
} from "../confidence";
import type { DecisionQuestion, DecisionRequest, DecisionSource } from "../decision-types";

export type AdapterLimits = {
  maxQuestions: number;
  maxChoices: number;
  maxScoreLevels: number;
  maxInputChars: number;
};

// shortcut: per-adapter defaults, not verified per provider. Catalog limits (catalog.limits) should
// override them once a source can name its catalog provider; DecisionSource has no such field yet.
export const DEFAULT_ADAPTER_LIMITS: AdapterLimits = {
  maxQuestions: 8,
  maxChoices: 16,
  maxScoreLevels: 10,
  maxInputChars: 32_000,
};

export type ParsedAnswer = {
  value: string | number | boolean;
  probabilities: Record<string, number>;
  /** Gateway scale, see confidence.ts. */
  confidence: number;
  /** The provider's own answer object, kept for diagnostics; never logged. */
  raw: unknown;
};

export type AdapterAnswers = Record<string, ParsedAnswer>;

export type AdapterOutput = { answers: AdapterAnswers; inputTokens?: number };

export type AdapterFailureCode =
  | "auth"
  | "rejected"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "malformed"
  | "not_configured";

/** A provider-side failure. Messages never contain response bodies, keys or full URLs. */
export class AdapterFailure extends Error {
  readonly code: AdapterFailureCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: AdapterFailureCode,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AdapterFailure";
    this.code = code;
    this.status = options.status;
    this.retryable =
      options.retryable ??
      (code === "rate_limited" || code === "unavailable" || code === "timeout");
  }
}

/** A caller error in the request itself. Unlike AdapterFailure it is not retried and not routed to another source. */
export class DecisionRequestError extends Error {
  constructor(message: string) {
    super(`DECISION_REQUEST_INVALID: ${message}`);
    this.name = "DecisionRequestError";
  }
}

/** Network access for adapters. The gateway supplies it, so tests replace it with fixtures. */
export type AdapterTransport = {
  postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
  runTextPrompt(input: {
    /** Provider harness of the llm source that asks; the runner decides what it means. */
    harness?: string;
    prompt: string;
    model?: string;
    signal: AbortSignal;
  }): Promise<string>;
};

export type AdapterCall = {
  source: DecisionSource;
  state: Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  /** Resolved from the vault only when the source has a secretRef. */
  apiKey?: string;
  signal: AbortSignal;
  transport: AdapterTransport;
};

export interface ContractAdapter {
  readonly id: DecisionSource["adapter"];
  readonly limits: AdapterLimits;
  run(call: AdapterCall): Promise<AdapterOutput>;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_QUESTIONS = 32;
const MAX_REQUEST_CHARS = 512_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export { isRecord };

/** Option keys of a question in the order used for probabilities. */
export function optionKeys(question: DecisionQuestion): string[] {
  if (question.type === "noul") return ["true", "false"];
  if (question.type === "choice") return Object.keys(question.criteria);
  return question.criteria.map((_, index) => String(index));
}

/** True when the question fits the limits of one source. A question that does not fit is skipped for that source only. */
export function fitsLimits(question: DecisionQuestion, limits: AdapterLimits): boolean {
  if (question.type === "choice") return Object.keys(question.criteria).length <= limits.maxChoices;
  if (question.type === "score") return question.criteria.length <= limits.maxScoreLevels;
  return true;
}

/** Checks the shape of a request before any source is called. Throws DecisionRequestError. */
export function assertValidRequest(request: DecisionRequest): void {
  if (!(DECISION_TASK_TYPES as readonly string[]).includes(request.taskType))
    throw new DecisionRequestError("unknown task type.");
  if (typeof request.personalData !== "boolean")
    throw new DecisionRequestError("personalData must be a boolean.");
  if (!isRecord(request.state)) throw new DecisionRequestError("state must be an object.");
  let stateJson: string;
  try {
    stateJson = JSON.stringify(request.state);
  } catch {
    throw new DecisionRequestError("state must be JSON-serializable.");
  }
  if (stateJson.length > MAX_REQUEST_CHARS) throw new DecisionRequestError("state is too large.");
  const names = Object.keys(request.questions);
  if (names.length === 0 || names.length > MAX_QUESTIONS)
    throw new DecisionRequestError(`questions must contain 1 to ${MAX_QUESTIONS} entries.`);
  for (const name of names) {
    if (!NAME_PATTERN.test(name)) throw new DecisionRequestError("question name is invalid.");
    const question = request.questions[name];
    if (!question.instructions || question.instructions.length > 1000)
      throw new DecisionRequestError(`question ${name} has invalid instructions.`);
    if (question.type === "noul") {
      if (!question.criteria || !question.criteria.true || !question.criteria.false)
        throw new DecisionRequestError(`question ${name} needs true and false criteria.`);
    } else if (question.type === "choice") {
      const count = Object.keys(question.criteria ?? {}).length;
      if (count < 2 || count > 64)
        throw new DecisionRequestError(`question ${name} needs 2 to 64 choices.`);
    } else if (question.type === "score") {
      const count = question.criteria?.length ?? 0;
      if (count < 2 || count > 16)
        throw new DecisionRequestError(`question ${name} needs 2 to 16 levels.`);
    } else {
      throw new DecisionRequestError(`question ${name} has an unknown type.`);
    }
  }
  if (
    request.timeoutMs !== undefined &&
    (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 120_000)
  )
    throw new DecisionRequestError("timeoutMs must be an integer from 100 to 120000.");
}

/**
 * Splits questions into requests that fit one source: at most maxQuestions per request and
 * within maxInputChars. State is repeated in each request. Throws AdapterFailure when the state or one
 * question alone is over the limit, so that only this source is skipped.
 */
export function planChunks(
  state: Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
  limits: AdapterLimits,
): Record<string, DecisionQuestion>[] {
  const size = (subset: Record<string, DecisionQuestion>) =>
    JSON.stringify({ state, questions: subset }).length;
  if (size({}) > limits.maxInputChars)
    throw new AdapterFailure("rejected", "The state exceeds the source input limit.", {
      retryable: false,
    });
  const chunks: Record<string, DecisionQuestion>[] = [];
  let current: Record<string, DecisionQuestion> = {};
  let count = 0;
  for (const [name, question] of Object.entries(questions)) {
    const candidate = { ...current, [name]: question };
    if (count > 0 && (count >= limits.maxQuestions || size(candidate) > limits.maxInputChars)) {
      chunks.push(current);
      current = { [name]: question };
    } else {
      current = candidate;
    }
    count = Object.keys(current).length;
    if (size(current) > limits.maxInputChars)
      throw new AdapterFailure("rejected", "A question exceeds the source input limit.", {
        retryable: false,
      });
  }
  if (count > 0) chunks.push(current);
  return chunks;
}

/** Builds one answer from a probability object keyed by option. Returns undefined when the object is incomplete or invalid. */
export function distributionAnswer(
  question: DecisionQuestion,
  probabilities: unknown,
  raw: unknown,
): ParsedAnswer | undefined {
  if (!isRecord(probabilities)) return undefined;
  const keys = optionKeys(question);
  const vector: number[] = [];
  for (const key of keys) {
    const value = probabilities[key];
    if (typeof value !== "number") return undefined;
    vector.push(value);
  }
  const normalized = normalizeDistribution(vector);
  if (!normalized) return undefined;
  const best = argmax(normalized);
  if (question.type === "noul") {
    const pTrue = normalized[0];
    return {
      value: pTrue >= 0.5,
      probabilities: { true: pTrue, false: normalized[1] },
      confidence: noulConfidence(pTrue),
      raw,
    };
  }
  return {
    value: question.type === "choice" ? keys[best] : best,
    probabilities: Object.fromEntries(keys.map((key, index) => [key, normalized[index]])),
    confidence: distributionConfidence(normalized),
    raw,
  };
}

const AUTH_HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
/** Framing, routing and cookie headers stay reserved; a key header may not replace them. */
const RESERVED_AUTH_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "cookie",
]);

/** A custom endpoint's key header must be a plain token name that does not frame or route the request. */
export function isAllowedAuthHeader(name: string): boolean {
  return AUTH_HEADER_NAME.test(name) && !RESERVED_AUTH_HEADERS.has(name.toLowerCase());
}

/** Bearer by default; a custom endpoint may name its key header instead. The key is never logged. */
export function bearerHeaders(
  apiKey: string | undefined,
  authHeader?: string,
): Record<string, string> {
  const auth: Record<string, string> = !apiKey
    ? {}
    : authHeader
      ? { [authHeader.toLowerCase()]: apiKey }
      : { authorization: `Bearer ${apiKey}` };
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...auth,
  };
}

export function requireEndpoint(endpoint: string | undefined): string {
  if (!endpoint)
    throw new AdapterFailure("not_configured", "The source has no endpoint.", { retryable: false });
  return endpoint;
}
