import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { reconnectLocalHost } from "../model/localHostService";
import type { RemoteMachine } from "../model/protocol";
import { errorText } from "../../../shared/lib/errors";

/** One Reconnect at a time for this computer's link; the failure reason stays until the next try. */
function useReconnect(machine: RemoteMachine, onReconnected?: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const reconnect = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await reconnectLocalHost(machine);
      onReconnected?.();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPending(false);
    }
  };
  return { pending, error, reconnect };
}

/**
 * A settings page's error when this computer's Host revoked the saved link: says so and offers
 * Reconnect. Reconnecting is the owner's choice; nothing pairs again on its own.
 */
export function LocalHostRevokedFeedback({
  machine,
  onReconnected,
}: {
  machine: RemoteMachine;
  /** Reload what the page showed; called once the link works again. */
  onReconnected?: () => void;
}) {
  const t = useT();
  const { pending, error, reconnect } = useReconnect(machine, onReconnected);
  return (
    <SettingsFeedback
      state="error"
      action={{ label: t("Reconnect"), onClick: () => void reconnect(), pending }}
    >
      {[t("This computer's connection to its Host was revoked."), error].filter(Boolean).join(" ")}
    </SettingsFeedback>
  );
}

/** The same notice for the app-wide notification panel, so every feature can recover. */
export function LocalHostRevokedNotice({ machine }: { machine: RemoteMachine }) {
  const t = useT();
  const { pending, error, reconnect } = useReconnect(machine);
  return (
    <Alert
      tone="warning"
      title={t("This computer's connection to its Host was revoked.")}
      action={{ label: t("Reconnect"), onClick: () => void reconnect(), pending }}
    >
      {error ?? t("Tasks, sessions and sync on this computer are unavailable until you reconnect.")}
    </Alert>
  );
}
