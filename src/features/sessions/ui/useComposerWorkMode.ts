import { useEffect, useState } from "react";
import { getComposerWorkMode, setComposerWorkMode } from "../model/draftCache";

/** Plan / Operator / Orchestrator picks, restored from the draft cache so a remount keeps them. */
export function useComposerWorkMode(sessionId: string | undefined) {
  const [initial] = useState(() => (sessionId ? getComposerWorkMode(sessionId) : undefined));
  const [planSelected, setPlanSelected] = useState(initial === "plan");
  const [operatorSelected, setOperatorSelected] = useState(initial === "operator");
  const [orchestrationSelected, setOrchestrationSelected] = useState(initial === "orchestrator");
  useEffect(() => {
    if (!sessionId) return;
    const mode = planSelected
      ? "plan"
      : operatorSelected
        ? "operator"
        : orchestrationSelected
          ? "orchestrator"
          : undefined;
    setComposerWorkMode(sessionId, mode);
  }, [sessionId, planSelected, operatorSelected, orchestrationSelected]);
  return {
    plan: [planSelected, setPlanSelected],
    operator: [operatorSelected, setOperatorSelected],
    orchestration: [orchestrationSelected, setOrchestrationSelected],
  } as const;
}
