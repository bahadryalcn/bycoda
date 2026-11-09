import type { DecisionQuestion } from "../decision-types";
import {
  AdapterFailure,
  type AdapterAnswers,
  type AdapterCall,
  type AdapterOutput,
  type ContractAdapter,
  DEFAULT_ADAPTER_LIMITS,
  distributionAnswer,
  isRecord,
  optionKeys,
} from "./common";

/**
 * Asks a general LLM for JSON probabilities per option. The probabilities go through the same
 * confidence formula as the decision models, so the threshold means the same thing for both.
 */
export function buildStructuredPrompt(
  state: Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
): string {
  const described = Object.entries(questions).map(([name, question]) => ({
    name,
    type: question.type,
    instructions: question.instructions,
    options: optionKeys(question),
    criteria: question.criteria,
  }));
  return [
    "You answer classification questions about the state below.",
    'Reply with JSON only, in this form: {"answers": {"<question name>": {"probabilities": {"<option>": <number>}}}}',
    "Use the option keys exactly as listed. Probabilities are non-negative and sum to 1 for each question.",
    "",
    "State:",
    JSON.stringify(state),
    "",
    "Questions:",
    JSON.stringify(described),
  ].join("\n");
}

/** Takes the outermost JSON object from the model's text, which may carry prose or a code fence. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new AdapterFailure("malformed", "The model reply has no JSON object.", {
      retryable: false,
    });
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    throw new AdapterFailure("malformed", "The model reply is not valid JSON.", {
      retryable: false,
    });
  }
}

export function parseStructuredAnswers(
  json: unknown,
  questions: Record<string, DecisionQuestion>,
): AdapterOutput {
  if (!isRecord(json) || !isRecord(json.answers))
    throw new AdapterFailure("malformed", "The model reply has no answers.", { retryable: false });
  const answers: AdapterAnswers = {};
  for (const [name, question] of Object.entries(questions)) {
    const entry = json.answers[name];
    if (!isRecord(entry)) continue;
    const answer = distributionAnswer(question, entry.probabilities, entry);
    if (answer) answers[name] = answer;
  }
  return { answers };
}

export const llmStructuredAdapter: ContractAdapter = {
  id: "llm-structured",
  limits: DEFAULT_ADAPTER_LIMITS,
  async run(call: AdapterCall) {
    const text = await call.transport.runTextPrompt({
      harness: call.source.harness,
      prompt: buildStructuredPrompt(call.state, call.questions),
      model: call.source.model,
      signal: call.signal,
    });
    return parseStructuredAnswers(extractJson(text), call.questions);
  },
};
