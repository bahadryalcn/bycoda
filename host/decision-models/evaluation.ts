import type { DecisionQuestion } from "./decision-types";

export type EvaluationCase = {
  id: string;
  state: Record<string, unknown>;
  question: DecisionQuestion;
  expected: string | boolean;
};

/**
 * Small fixed set, translated to English from the owner's recorded Clef run (clef verification
 * 20261006T104640Z, cases C01, C05, C07, C08, C11, C12). It checks that a source answers and that the answer is right.
 * It is not a calibration of confidence.
 */
export const EVALUATION_SET: EvaluationCase[] = [
  {
    id: "C01-business-area",
    state: {
      text: "A new merchant account is being opened and the membership agreement is being accepted.",
    },
    question: {
      type: "choice",
      instructions: "Which business area does the operation belong to?",
      criteria: {
        Onboarding: "Membership, merchant registration and agreement acceptance",
        Payment: "Starting and completing a payment",
        Refund: "Refunds and cancellations",
        Other: "Report downloads or other work",
      },
    },
    expected: "Onboarding",
  },
  {
    id: "C05-sql-operation",
    state: { sql: "SELECT count(*) FROM transactions;" },
    question: {
      type: "choice",
      instructions: "What kind of operation does this SQL perform?",
      criteria: {
        Read: "Only reads existing data",
        Delete: "Deletes data",
      },
    },
    expected: "Read",
  },
  {
    id: "C07-consent-negative",
    state: { text: "The user clearly said they do not want to receive campaign emails." },
    question: {
      type: "noul",
      instructions: "Does the user want to receive campaign emails?",
      criteria: { true: "Yes", false: "No" },
    },
    expected: false,
  },
  {
    id: "C08-consent-positive",
    state: { text: "The user clearly said they want to receive campaign emails." },
    question: {
      type: "noul",
      instructions: "Does the user want to receive campaign emails?",
      criteria: { true: "Yes", false: "No" },
    },
    expected: true,
  },
  {
    id: "C11-score-not-started",
    state: { text: "The operation has not started yet. No step has been done." },
    question: {
      type: "score",
      instructions: "How far has the operation been completed?",
      criteria: [
        "The operation has not started",
        "The operation is in progress",
        "The operation completed successfully",
      ],
    },
    expected: "0",
  },
  {
    id: "C12-score-completed",
    state: { text: "All steps are done. The operation finished successfully." },
    question: {
      type: "score",
      instructions: "How far has the operation been completed?",
      criteria: [
        "The operation has not started",
        "The operation is in progress",
        "The operation completed successfully",
      ],
    },
    expected: "2",
  },
];

/**
 * Accuracy over the set. `values[i]` is the answer value for case i (undefined when no answer was
 * above threshold). A missing or wrong answer counts as wrong.
 */
export function evaluationAccuracy(
  values: readonly (string | number | boolean | undefined)[],
  cases: readonly EvaluationCase[] = EVALUATION_SET,
): number {
  if (cases.length === 0) return 0;
  let correct = 0;
  cases.forEach((testCase, index) => {
    const value = values[index];
    if (value !== undefined && String(value) === String(testCase.expected)) correct += 1;
  });
  return correct / cases.length;
}
