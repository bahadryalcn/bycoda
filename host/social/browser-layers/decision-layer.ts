import {
  DEFAULT_THRESHOLD,
  type DecisionAnswer,
  type DecisionErrorCode,
  type DecisionResult,
  type DecisionService,
} from "../../decision-models/decision-types";
import type { ScreenCandidate, ScreenSnapshot } from "./screen-summary";

export const SCREEN_STATES = [
  "cookie_banner",
  "confirm_dialog",
  "error",
  "captcha",
  "login",
  "verification",
  "unexpected",
] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

/** Screens the decision layer may act on, with at most one button click. */
export const ACTABLE_STATES: readonly ScreenState[] = ["cookie_banner", "confirm_dialog"];
/** Screens that always become NEEDS_HUMAN. The layer never interacts with them. */
export const HUMAN_STATES: readonly ScreenState[] = ["captcha", "login", "verification"];

const SCREEN_CRITERIA: Record<ScreenState, string> = {
  cookie_banner: "a cookie or consent banner covering the page",
  confirm_dialog: "a dialog asking the user to confirm or dismiss something, not a form to fill",
  error: "an error or failure message",
  captcha: "a CAPTCHA or 'I am not a robot' check",
  login: "a sign-in or sign-up form",
  verification: "a request for a one-time code or identity verification",
  unexpected: "none of the above",
};

/**
 * Labels that could submit, pay, send, delete or sign in. A candidate with such a label is never clicked.
 * shortcut: label denylist; upgrade to a per-platform allowlist of dismiss labels.
 */
const UNSAFE_LABEL =
  /delete|remove|pay|purchase|buy|checkout|send|post|publish|submit|sign|log ?in|log ?out|verify|transfer|withdraw|deactivate|close account|unsubscribe|sil|kaldır|öde|gönder|paylaş|onayla|giriş|yayınla/i;

export function isUnsafeLabel(label: string): boolean {
  return UNSAFE_LABEL.test(label);
}

export type LayerChoice<T> =
  | { ok: true; value: T; confidence: number }
  | { ok: false; reason: "unavailable" | "below_threshold" | "no_candidate" };

/** Reads one answer. Provider errors and low confidence both mean "not usable"; the caller moves on. */
function readAnswer(
  result: DecisionResult,
  key: string,
  threshold: number,
):
  | { ok: true; value: string; confidence: number }
  | { ok: false; reason: "unavailable" | "below_threshold" } {
  const answer: DecisionAnswer | { error: DecisionErrorCode } | undefined = result.answers[key];
  if (!answer || "error" in answer || typeof answer.value !== "string")
    return { ok: false, reason: "unavailable" };
  if (!(answer.confidence >= threshold)) return { ok: false, reason: "below_threshold" };
  return { ok: true, value: answer.value, confidence: answer.confidence };
}

/** Asks the screen-state question. Only the summary text goes to the model, never selectors or values. */
export async function classifyScreen(
  decisions: DecisionService,
  snapshot: ScreenSnapshot,
  threshold = DEFAULT_THRESHOLD,
): Promise<LayerChoice<ScreenState>> {
  const { summary } = snapshot;
  const result = await decisions.decide({
    taskType: "screen_state",
    personalData: false,
    state: {
      url: summary.url,
      title: summary.title,
      buttons: summary.buttons,
      fields: summary.fields,
      headings: summary.headings,
      errors: summary.errors,
    },
    questions: {
      state: {
        type: "choice",
        instructions: "Which kind of browser screen is this? Pick exactly one key.",
        criteria: SCREEN_CRITERIA,
      },
    },
  });
  const answer = readAnswer(result, "state", threshold);
  if (!answer.ok) return answer;
  if (!(SCREEN_STATES as readonly string[]).includes(answer.value))
    return { ok: false, reason: "unavailable" };
  return { ok: true, value: answer.value as ScreenState, confidence: answer.confidence };
}

/** Asks which candidate button dismisses the screen. The answer must name one of the given candidates. */
export async function chooseCandidate(
  decisions: DecisionService,
  candidates: ScreenCandidate[],
  threshold = DEFAULT_THRESHOLD,
): Promise<LayerChoice<ScreenCandidate>> {
  if (candidates.length === 0) return { ok: false, reason: "no_candidate" };
  const result = await decisions.decide({
    taskType: "element_choice",
    personalData: false,
    state: { buttons: candidates.map((item) => ({ id: item.id, label: item.label })) },
    questions: {
      element: {
        type: "choice",
        instructions: "Which button dismisses this screen with the least risk? Pick its id.",
        criteria: Object.fromEntries(candidates.map((item) => [item.id, item.label])),
      },
    },
  });
  const answer = readAnswer(result, "element", threshold);
  if (!answer.ok) return answer;
  const candidate = candidates.find((item) => item.id === answer.value);
  return candidate
    ? { ok: true, value: candidate, confidence: answer.confidence }
    : { ok: false, reason: "unavailable" };
}
