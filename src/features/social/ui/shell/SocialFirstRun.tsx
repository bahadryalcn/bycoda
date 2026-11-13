import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decisionModelsClient,
  DecisionModelsFirstRunCard,
  openDecisionModelsSettings,
} from "../../../decision-models";

const LEGACY_KEY = "bycoda.social.decisionFirstRunDismissed";

/** Consume the old viewer-wide preference once, on the first selected Host only. */
function takeLegacyDismissal(): boolean {
  try {
    if (localStorage.getItem(LEGACY_KEY) !== "1") return false;
    localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch {
    // Blocked storage must never broadcast a global preference to other Hosts.
    return false;
  }
}

export type SocialFirstRunProps = { machineId: string };

/** Remount Host-bound reads and dismissal state together when the selected Host changes. */
export function SocialFirstRun({ machineId }: SocialFirstRunProps) {
  const [dismissedHosts, setDismissedHosts] = useState<Set<string>>(() => new Set());
  return machineId && !dismissedHosts.has(machineId) ? (
    <HostFirstRun
      key={machineId}
      machineId={machineId}
      onDismissed={() => setDismissedHosts((current) => new Set([...current, machineId]))}
    />
  ) : null;
}

function HostFirstRun({ machineId, onDismissed }: SocialFirstRunProps & { onDismissed(): void }) {
  const [client] = useState(() => decisionModelsClient(machineId));
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["social", "decision-first-run", machineId];
  const offer = useQuery({
    queryKey,
    queryFn: async () => {
      if (takeLegacyDismissal()) {
        await client.firstRun.set({ dismissed: true }).catch(() => undefined);
        return false;
      }
      const [state, catalog] = await Promise.all([
        client.firstRun.get({}),
        client.sources.list({}),
      ]);
      return (
        typeof state?.dismissed === "boolean" &&
        !state.dismissed &&
        Array.isArray(catalog?.sources) &&
        catalog.sources.length === 0
      );
    },
    retry: false,
    staleTime: 30_000,
  });

  const dismiss = () => {
    setDismissed(true);
    queryClient.setQueryData(queryKey, false);
    onDismissed();
    void client.firstRun.set({ dismissed: true }).catch(() => undefined);
  };
  if (!offer.data || dismissed) return null;
  return (
    <DecisionModelsFirstRunCard
      client={client}
      onDismiss={dismiss}
      onOpenSettings={() => {
        dismiss();
        openDecisionModelsSettings();
      }}
    />
  );
}
