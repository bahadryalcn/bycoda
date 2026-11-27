import { useT } from "../../../shared/i18n";
import type {
  LiveStreamLiveDestination,
  LiveStreamLiveStatus,
} from "../../../shared/model/host-contracts/live-stream";
import { StatusText } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { destinationTone, platformNames } from "../model/liveDestinations";

type Translate = ReturnType<typeof useT>;

/** One row per destination with its own state; a failed row says why. */
export function LiveDestinationStatus({
  destinations,
  overallReason,
}: {
  destinations: readonly LiveStreamLiveDestination[];
  /** Reason already shown for the whole broadcast; rows with the same reason do not repeat it. */
  overallReason?: LiveStreamLiveStatus["reason"];
}) {
  const t = useT();
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("Destinations")}>
      {destinations.map((destination) => {
        const why =
          destination.state === "failed"
            ? [
                destination.reason === overallReason
                  ? undefined
                  : streamReason(destination.reason, t),
                destination.detail,
              ]
                .filter(Boolean)
                .join(" ")
            : "";
        return (
          <li key={destination.accountId} className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <Text size="body" tone="primary" truncate>
                {t("{p0} · {p1}", {
                  p0: platformNames[destination.platform],
                  p1: destination.label,
                })}
              </Text>
              <StatusText tone={destinationTone(destination.state)}>
                {stateLabel(destination.state, t)}
              </StatusText>
            </div>
            {why ? <Text size="caption">{why}</Text> : null}
          </li>
        );
      })}
    </ul>
  );
}

function stateLabel(state: LiveStreamLiveDestination["state"], t: Translate) {
  switch (state) {
    case "starting":
      return t("Starting…");
    case "streaming":
      return t("Streaming");
    case "failed":
      return t("Failed");
    case "ended":
      return t("Ended");
  }
}

export function streamReason(reason: LiveStreamLiveStatus["reason"], t: Translate) {
  switch (reason) {
    case "OBS_NOT_CONFIGURED":
      return t("Set up OBS before starting a broadcast.");
    case "OBS_UNAVAILABLE":
      return t("Open OBS and check its WebSocket connection.");
    case "OBS_ALREADY_STREAMING":
      return t("Stop the current OBS stream before switching accounts.");
    case "SCENE_NOT_FOUND":
      return t("The selected scene could not be found in OBS.");
    case "VERTICAL_CANVAS_UNAVAILABLE":
      return t(
        "Install Aitum Vertical in OBS and add one stream output in its settings to stream to TikTok or Instagram.",
      );
    case "RELAY_UNAVAILABLE":
      return t("Install ffmpeg and add it to PATH to stream to several platforms at once.");
    case "RELAY_FAILED":
      return t("The connection to this platform dropped. Check its stream settings and try again.");
    case "ACCOUNT_UNAVAILABLE":
      return t("Reconnect this account in Social.");
    case "AUTHORITY_DENIED":
      return t("Check publishing permissions and stops in Social.");
    case "LIVE_CREDENTIALS_MISSING":
      return t("Save this account’s LIVE server and key in Social.");
    case "OWNER_STEP_REQUIRED":
      return t("Complete the remaining step on the platform to confirm the broadcast.");
    case "PLATFORM_FAILED":
      return t("The platform could not complete the broadcast action.");
    case "START_UNCERTAIN":
    case "STOP_UNCERTAIN":
      return t(
        "Could not confirm the broadcast action. Check OBS and the platform before trying again.",
      );
    case "CANCELED":
      return t("Cancelled");
    case undefined:
      return undefined;
  }
}
