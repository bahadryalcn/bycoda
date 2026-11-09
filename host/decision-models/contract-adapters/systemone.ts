import type { DecisionQuestion } from "../decision-types";
import {
  AdapterFailure,
  type AdapterAnswers,
  type AdapterCall,
  type AdapterOutput,
  type ContractAdapter,
  DEFAULT_ADAPTER_LIMITS,
  bearerHeaders,
  distributionAnswer,
  isRecord,
  requireEndpoint,
} from "./common";

export type SystemOneAdapterId = "systemone" | "decisions" | "ollama-systemone" | "custom";

/**
 * Request body of the System One contract: optional model, the state and the named questions.
 * Verified against the owner's Clef proxy (clef/proxy.mjs route /v1/systemone; example-request.json).
 */
export function systemOneBody(call: AdapterCall): Record<string, unknown> {
  return {
    ...(call.source.model ? { model: call.source.model } : {}),
    state: call.state,
    questions: call.questions,
  };
}

function parseEntry(
  question: DecisionQuestion,
  entry: Record<string, unknown>,
): AdapterAnswers[string] | undefined {
  if (question.type === "noul") {
    // Clef returns one number for a noul question: P(true). Probabilities are rebuilt from it.
    const pTrue = entry.noul;
    if (typeof pTrue !== "number" || !Number.isFinite(pTrue) || pTrue < 0 || pTrue > 1)
      return undefined;
    return distributionAnswer(question, { true: pTrue, false: 1 - pTrue }, entry);
  }
  const answer = distributionAnswer(question, entry.probabilities, entry);
  if (!answer) return undefined;
  // A reported choice that disagrees with its own probabilities makes the entry inconsistent.
  if (
    question.type === "choice" &&
    typeof entry.choice === "string" &&
    entry.choice !== answer.value
  )
    return undefined;
  return answer;
}

/** Parses the answers object. A missing or malformed question is left out, so the gateway can try the next source for it. */
export function parseSystemOneAnswers(
  json: unknown,
  questions: Record<string, DecisionQuestion>,
): AdapterOutput {
  if (!isRecord(json) || !isRecord(json.answers))
    throw new AdapterFailure("malformed", "The decision source response has no answers.", {
      retryable: false,
    });
  const answers: AdapterAnswers = {};
  for (const [name, question] of Object.entries(questions)) {
    const entry = json.answers[name];
    if (!isRecord(entry) || entry.type !== question.type) continue;
    const answer = parseEntry(question, entry);
    if (answer) answers[name] = answer;
  }
  const usage = isRecord(json.usage) ? json.usage.input_tokens : undefined;
  return typeof usage === "number" ? { answers, inputTokens: usage } : { answers };
}

/** Adapter with the System One layout. decisions, ollama-systemone and custom reuse it under assumptions listed in their files. */
export function createSystemOneAdapter(id: SystemOneAdapterId): ContractAdapter {
  return {
    id,
    limits: DEFAULT_ADAPTER_LIMITS,
    async run(call) {
      const endpoint = requireEndpoint(call.source.endpoint);
      const json = await call.transport.postJson(
        endpoint,
        bearerHeaders(call.apiKey, call.source.authHeader),
        systemOneBody(call),
        call.signal,
      );
      return parseSystemOneAnswers(json, call.questions);
    },
  };
}

export const systemOneAdapter = createSystemOneAdapter("systemone");
