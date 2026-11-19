import machineOffline from "../../../assets/connections/machine-offline.webp";
import { t, useLocale } from "../../../shared/i18n";
import { FailureState } from "../../../shared/ui/FailureState";
import { knownRemoteMachine, OPEN_CONNECTIONS_EVENT } from "../model/connections";
import type { ReactNode } from "react";
import {
  machineHidesView,
  useMachineAvailability,
  type MachineUnavailableReason,
} from "../model/machineAvailability";
import { parseRemotePath } from "../model/remoteProjects";

/** The one sentence that says why, and what the user can do about it. */
function reasonText(reason: MachineUnavailableReason): string {
  switch (reason) {
    case "not-added":
      return t(
        "This computer doesn’t have this project’s machine yet. Add it in Connections to open the project.",
      );
    case "pairing-refused":
      return t("The machine no longer accepts this computer. Pair them again in Connections.");
    case "needs-sign-in":
      return t("The machine needs you to sign in again. Open Connections to reconnect.");
    case "offline":
      return t("The machine isn’t answering. Waiting for it to come back.");
    case "turned-off":
      return t("The machine is turned off on this computer. Turn it on in Connections.");
  }
}

/**
 * What every view of a remote project shows instead of its content while the project's
 * machine cannot be asked: an illustration, one title, the reason and Manage connections.
 * Renders nothing while the machine is available. `size="compact"` drops the illustration
 * for a narrow list; `panel` shows it small.
 */
export function MachineUnavailable({
  cwd,
  reason: shownReason,
  size = "panel",
}: {
  cwd: string;
  /** A reason the caller already knows (a session pane that found no saved machine). */
  reason?: MachineUnavailableReason;
  size?: "page" | "panel" | "compact";
}) {
  useLocale();
  const availability = useMachineAvailability(cwd);
  const reason = shownReason ?? (availability.available ? undefined : availability.reason);
  if (!reason) return null;
  const environmentId = parseRemotePath(cwd)?.environmentId;
  const name = environmentId ? knownRemoteMachine(environmentId)?.name : undefined;
  return (
    <FailureState
      data-machine-unavailable={reason}
      context={size === "compact" ? "list" : size}
      role="status"
      className={size === "compact" ? undefined : "h-full"}
      icon={
        size === "compact" ? null : (
          <img
            src={machineOffline}
            alt=""
            width={320}
            height={240}
            draggable={false}
            className={`h-auto w-full ${size === "page" ? "max-w-80" : "max-w-48"}`}
          />
        )
      }
      title={
        name ? t("{p0} isn’t available", { p0: name }) : t("This project’s machine isn’t available")
      }
      description={reasonText(reason)}
      action={{
        label: t("Manage machines"),
        onClick: () => window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT)),
      }}
    />
  );
}

/**
 * Shows `children` (a pane's content) unless its project's machine hides it: the shared
 * notice replaces them for every unavailable reason, except an offline machine when the pane
 * already has data (`hasData`), which keeps it. See `machineHidesView`. Mount the content only
 * through this gate, so a hidden pane starts no read.
 */
export function MachineGate({
  cwd,
  hasData,
  size,
  children,
}: {
  cwd: string;
  /** Whether the pane already holds something loaded for this project. Read each time the
   * machine's availability changes, so it sees what loaded since the pane last rendered. */
  hasData: () => boolean;
  size?: "page" | "panel" | "compact";
  children: ReactNode;
}) {
  const availability = useMachineAvailability(cwd);
  if (availability.available || !machineHidesView(availability, hasData())) return children;
  return <MachineUnavailable cwd={cwd} size={size} />;
}
