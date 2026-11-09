import { useMemo, useState } from "react";
import {
  decisionModelsClient,
  DecisionModelsFirstRunCard,
  openDecisionModelsSettings,
} from "../../../decision-models";

/**
 * Per-viewer memory of "Not now". The Host has no RPC for the dismissal yet, so it stays in this
 * browser; shortcut: move to a Host-side flag once `decisionModels.firstRun` exists.
 */
const DISMISSED_KEY = "bycoda.social.decisionFirstRunDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage blocked: the offer may show again next time, which is harmless.
  }
}

export type SocialFirstRunProps = {
  machineId: string;
};

/** Social's first-open offer to set up a decision model. Hidden after "Not now". */
export function SocialFirstRun({ machineId }: SocialFirstRunProps) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const client = useMemo(() => (machineId ? decisionModelsClient(machineId) : null), [machineId]);
  if (dismissed || !client) return null;
  return (
    <DecisionModelsFirstRunCard
      client={client}
      onDismiss={() => {
        writeDismissed();
        setDismissed(true);
      }}
      onOpenSettings={openDecisionModelsSettings}
    />
  );
}
