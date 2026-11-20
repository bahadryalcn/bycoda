import { useState } from "react";
import { t } from "../../../shared/i18n";
import type { DecisionSource, DecisionSourceInput, SourceTestResult } from "../model/decisionTypes";
import { sourceErrorText } from "../model/decisionView";

export type AddPhase = "editing" | "saving" | "testing" | "done";
export type AddOutcome = { tone: "success" | "warning"; text: string };

/**
 * Shared "add, then test" flow for the add dialogs. The key is passed through to `onAdd`; the caller keeps
 * its key field until `submit` resolves `true` (the source was added), so a failed add keeps the typed key.
 */
export function useAddAndTest(deps: {
  onAdd: (input: DecisionSourceInput, apiKey?: string) => Promise<DecisionSource>;
  onTest: (id: string) => Promise<SourceTestResult>;
}) {
  const [phase, setPhase] = useState<AddPhase>("editing");
  const [failure, setFailure] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<AddOutcome | null>(null);

  /** Resolves `true` once the source is added (the key was saved), `false` if adding failed. */
  const submit = async (
    input: DecisionSourceInput,
    contract: string,
    apiKey?: string,
  ): Promise<boolean> => {
    setFailure(null);
    setOutcome(null);
    setPhase("saving");
    let created: DecisionSource;
    try {
      created = await deps.onAdd(input, apiKey);
    } catch (error: unknown) {
      setFailure(error);
      setPhase("editing");
      return false;
    }
    setPhase("testing");
    try {
      const result = await deps.onTest(created.id);
      setOutcome(
        result.ok
          ? {
              tone: "success",
              text: t("Added. The connection works. Contract: {p1}.", { p1: contract }),
            }
          : {
              tone: "warning",
              text: t("Added. The connection test failed: {p1}", {
                p1: sourceErrorText(result.error),
              }),
            },
      );
    } catch (error: unknown) {
      setFailure(error);
      setOutcome({ tone: "warning", text: t("Added, but the test did not finish.") });
    }
    setPhase("done");
    return true;
  };

  return {
    phase,
    busy: phase === "saving" || phase === "testing",
    done: phase === "done",
    failure,
    outcome,
    submit,
    setFailure,
  };
}
