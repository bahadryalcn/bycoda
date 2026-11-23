import { useSyncExternalStore, type ReactNode } from "react";
import connectComputer from "../../../assets/onboarding/connect-computer.webp";
import connectComputerStill from "../../../assets/onboarding/connect-computer-still.webp?no-inline";
import errorScene from "../../../assets/connections/error.webp";
import errorStill from "../../../assets/connections/error-still.webp?no-inline";
import offlineScene from "../../../assets/connections/offline.webp";
import offlineStill from "../../../assets/connections/offline-still.webp?no-inline";
import unreachableScene from "../../../assets/connections/unreachable.webp";
import unreachableStill from "../../../assets/connections/unreachable-still.webp?no-inline";
import { t, useLocale } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Spinner } from "../../../shared/ui/Spinner";
import { Text } from "../../../shared/ui/Text";
import { useDecorativeMotionEnabled } from "../../settings/public/decorativeMotion";
import { knownRemoteMachine, OPEN_CONNECTIONS_EVENT } from "../model/connections";
import {
  machineHidesView,
  useMachineAvailability,
  type MachineUnavailableReason,
} from "../model/machineAvailability";
import { parseRemotePath } from "../model/remoteProjects";
import {
  isReconnecting,
  reconnectRemoteMachine,
  subscribeReconnecting,
} from "../model/remoteReconnect";
import { useGracedFailure } from "../model/transientFailure";

/** The mobile app's scenes exported for the desktop: animated and still (frame 0) per scene. */
const SCENES = {
  "connect-computer": {
    animated: connectComputer,
    still: connectComputerStill,
    width: 240,
    height: 184,
  },
  unreachable: { animated: unreachableScene, still: unreachableStill, width: 203, height: 240 },
  offline: { animated: offlineScene, still: offlineStill, width: 129, height: 240 },
  error: { animated: errorScene, still: errorStill, width: 189, height: 240 },
} as const;
export type MachineScene = keyof typeof SCENES;

/**
 * Which scene says this state: a machine that is not added or turned off is "connect a computer",
 * one that needs sign-in or refused pairing is an error, an offline one is "unreachable" while
 * this computer has a network and "offline" while the network itself is down.
 */
export function machineScene(reason: MachineUnavailableReason, networkDown = false): MachineScene {
  switch (reason) {
    case "not-added":
    case "turned-off":
      return "connect-computer";
    case "needs-sign-in":
    case "pairing-refused":
      return "error";
    case "offline":
      return networkDown ? "offline" : "unreachable";
  }
}

/** The explanation behind the info affordance: why, and what the user can do about it. */
function reasonText(reason: MachineUnavailableReason, networkDown: boolean): string {
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
      return networkDown
        ? t("This computer has no network connection. bycoda reconnects when it is back.")
        : t(
            "The machine doesn’t answer on its home-network address or through Tailscale. It may be asleep or off, or Tailscale may be disconnected. bycoda keeps trying.",
          );
    case "turned-off":
      return t("The machine is turned off on this computer. Turn it on in Connections.");
  }
}

function subscribeNetwork(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** A scene as a decorative picture: animated, or its still frame while decorative motion is off. */
function MachineSceneArt({ scene, size }: { scene: MachineScene; size: "page" | "panel" }) {
  const motion = useDecorativeMotionEnabled();
  const art = SCENES[scene];
  return (
    <img
      src={motion ? art.animated : art.still}
      alt=""
      width={art.width}
      height={art.height}
      draggable={false}
      data-scene={scene}
      className={["w-auto max-w-full", size === "page" ? "h-48" : "h-28"].join(" ")}
    />
  );
}

/**
 * What every view of a remote project shows instead of its content while the project's
 * machine cannot be asked: one title (the reason sits behind the info affordance) and the one next
 * step. `page` (the session pane) adds the scene for the reason and offers Manage connections;
 * `panel` (side panels, the session list) is compact and has no art. An offline machine shows
 * "Reconnecting…" while an attempt runs and "Try now" between attempts.
 * Renders nothing while the machine is available.
 */
export function MachineUnavailable({
  cwd,
  reason: shownReason,
  size = "panel",
}: {
  cwd: string;
  /** A reason the caller already knows (a session pane that found no saved machine). */
  reason?: MachineUnavailableReason;
  size?: "page" | "panel";
}) {
  useLocale();
  const availability = useMachineAvailability(cwd);
  const reason = shownReason ?? (availability.available ? undefined : availability.reason);
  const environmentId = parseRemotePath(cwd)?.environmentId;
  const reconnecting = useSyncExternalStore(
    subscribeReconnecting,
    () => !!environmentId && isReconnecting(environmentId),
    () => false,
  );
  const networkDown = !useSyncExternalStore(
    subscribeNetwork,
    () => navigator.onLine,
    () => true,
  );
  const offline = useGracedFailure({
    error: reason === "offline" ? "Machine is unreachable" : undefined,
    scope: cwd,
  });
  if (!reason) return null;
  if (offline.pending)
    return (
      <div className="grid h-full place-items-center" aria-busy>
        <Spinner />
      </div>
    );
  const name = environmentId ? knownRemoteMachine(environmentId)?.name : undefined;
  // The saved name alone ("evpc") reads as a code; "your computer evpc" says what it is.
  const title = !name
    ? t("This project’s machine isn’t available")
    : reason === "offline"
      ? t("Your computer {p0} isn’t reachable right now", { p0: name })
      : t("Your computer {p0} isn’t available", { p0: name });
  const retryable = reason === "offline" && !!environmentId && !reconnecting;
  const manage = size === "page" && reason !== "offline";
  return (
    <EmptyState
      data-machine-unavailable={reason}
      context={size}
      role="status"
      className="h-full"
      // The scene is for the page; a compact panel carries no art.
      icon={
        size === "page" ? (
          <MachineSceneArt scene={machineScene(reason, networkDown)} size={size} />
        ) : undefined
      }
      title={title}
      description={reasonText(reason, networkDown)}
      action={
        retryable
          ? {
              label: t("Try now"),
              // The attempt reports its own failure through the connection state shown here.
              onClick: () => void reconnectRemoteMachine(environmentId).catch(() => undefined),
            }
          : manage
            ? {
                label: t("Manage machines"),
                onClick: () => window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT)),
              }
            : undefined
      }
      extra={reconnecting ? <Text>{t("Reconnecting…")}</Text> : undefined}
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
  size?: "page" | "panel";
  children: ReactNode;
}) {
  const availability = useMachineAvailability(cwd);
  if (availability.available || !machineHidesView(availability, hasData())) return children;
  return <MachineUnavailable cwd={cwd} size={size} />;
}
