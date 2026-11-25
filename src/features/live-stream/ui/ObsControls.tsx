import { useT } from "../../../shared/i18n";
import type { LiveStreamStatus } from "../../../shared/model/host-contracts/live-stream";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { StatusText } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { MonitorSmartphone } from "../../../shared/ui/icons";
import type { LiveStreamFeedback, LiveStreamLiveQuery } from "../hooks/useLiveStream";
import { liveStreamRequest } from "../model/liveStreamClient";
import { LiveSection } from "./LiveSection";

/** Step 2: connect OBS and show the scene it broadcasts. */
export function ObsControls({
  status,
  feedback,
  live,
}: {
  status: LiveStreamStatus;
  feedback: LiveStreamFeedback;
  live: LiveStreamLiveQuery;
}) {
  const t = useT();
  const operationError = feedback.error("obs-setup", "obs-start", "obs-stop");
  const setupPending = feedback.pending("obs-setup");
  const managed =
    live.data?.canStop || live.data?.state === "starting" || live.data?.state === "stopping";

  return (
    <LiveSection
      step={2}
      title={t("Scene")}
      status={
        <StatusText
          tone={
            status.obs.streaming && !managed ? "done" : status.obs.configured ? "idle" : "needs-you"
          }
        >
          {status.obs.streaming && !managed
            ? t("OBS streaming")
            : status.obs.configured
              ? t("OBS configured")
              : t("OBS not configured")}
        </StatusText>
      }
    >
      {status.obs.scene ? (
        <Text size="caption" tone="secondary">
          {status.obs.scene}
        </Text>
      ) : null}
      <div>
        <Button
          variant={status.obs.configured ? "secondary" : "primary"}
          startIcon={<MonitorSmartphone />}
          disabled={feedback.busy || managed}
          disabledReason={
            managed
              ? t("Stop the current stream before changing the OBS setup.")
              : t("Wait for the current live stream action to finish.")
          }
          loading={setupPending}
          success={feedback.succeeded("obs-setup")}
          successLabel={t("OBS configured")}
          onClick={() =>
            feedback.run({
              action: "obs-setup",
              request: () => liveStreamRequest("liveStream.obsSetup", {}),
            })
          }
        >
          {t("Set up OBS")}
        </Button>
      </div>
      {operationError ? (
        <InlineError details={operationError}>{t("Could not control OBS")}</InlineError>
      ) : null}
    </LiveSection>
  );
}
