import { useState } from "react";
import { useT } from "../../../shared/i18n";
import type { LiveStreamStatus } from "../../../shared/model/host-contracts/live-stream";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Check, Play, Square } from "../../../shared/ui/icons";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { StatusText } from "../../../shared/ui/StatusText";
import type {
  LiveStreamAccountsQuery,
  LiveStreamFeedback,
  LiveStreamLiveQuery,
} from "../hooks/useLiveStream";
import {
  CONFIGURED_OBS,
  hasVerticalAccount,
  platformNames,
  selectedAccounts,
  toggleSelection,
} from "../model/liveDestinations";
import { liveStreamRequest } from "../model/liveStreamClient";
import { LiveDestinationPicker } from "./LiveDestinationPicker";
import { LiveDestinationStatus, streamReason } from "./LiveDestinationStatus";

export function LiveStreamControls({
  obs,
  live,
  accounts,
  feedback,
}: {
  obs: LiveStreamStatus["obs"];
  live: LiveStreamLiveQuery;
  accounts: LiveStreamAccountsQuery;
  feedback: LiveStreamFeedback;
}) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const [selected, setSelected] = useState<string[]>([CONFIGURED_OBS]);
  const available = accounts.data?.accounts ?? [];
  const picked = selectedAccounts(selected, available);
  const obsChosen = selected.includes(CONFIGURED_OBS);
  const activity = live.data;
  const destinations = activity?.destinations ?? [];
  const managed = Boolean(
    activity?.canStop || activity?.state === "starting" || activity?.state === "stopping",
  );
  const stopping =
    activity?.state === "stopping" || feedback.pending("live-stop") || feedback.pending("obs-stop");
  const starting =
    activity?.state === "starting" ||
    feedback.pending("live-start") ||
    feedback.pending("obs-start");
  const liveDestinations = destinations
    .map((entry) => `${platformNames[entry.platform]} · ${entry.label}`)
    .join(", ");
  const shouldStop = Boolean(activity?.canStop || obs.streaming);
  const requiresManualCredentials =
    obsChosen && activity?.managedDestination && !managed && !obs.streaming;
  const reason =
    activity && (managed || destinations.length > 0) ? streamReason(activity.reason, t) : undefined;
  const hasSelection = picked.length > 0 || obsChosen;

  const start = () => {
    if (picked.length > 0) {
      void confirm({
        title: t("Start streaming"),
        message: t("OBS will broadcast {p0} to {p1}.", {
          p0: obs.scene ?? t("Scene"),
          p1: picked.map((entry) => `${platformNames[entry.platform]} · ${entry.label}`).join(", "),
        }),
        confirmLabel: t("Start streaming"),
        danger: false,
        onConfirm: () => {
          feedback.run({
            action: "live-start",
            requestLive: () =>
              liveStreamRequest("liveStream.live.start", {
                accountIds: picked.map((entry) => entry.accountId),
                scene: obs.scene,
              }),
          });
        },
      }).catch(() => undefined);
      return;
    }
    if (!obsChosen) return;
    void confirm({
      title: t("Start streaming"),
      message: t("OBS will go live on its configured streaming server."),
      confirmLabel: t("Start streaming"),
      danger: false,
      onConfirm: () => {
        feedback.run({
          action: "obs-start",
          request: () => liveStreamRequest("liveStream.obsStream", { action: "start" }),
        });
      },
    }).catch(() => undefined);
  };

  const stop = () => {
    if (activity?.needsPlatformConfirmation) {
      void confirm({
        title: t("Confirm broadcast ended"),
        message: t("End any live or pending broadcast on the platform before confirming."),
        context: liveDestinations,
        confirmLabel: t("Confirm broadcast ended"),
        danger: false,
        onConfirm: () =>
          feedback.run({
            action: "live-stop",
            requestLive: () => liveStreamRequest("liveStream.live.stop", { platformEnded: true }),
          }),
      }).catch(() => undefined);
    } else if (activity?.canStop) {
      feedback.run({
        action: "live-stop",
        requestLive: () => liveStreamRequest("liveStream.live.stop", {}),
      });
    } else {
      feedback.run({
        action: "obs-stop",
        request: () => liveStreamRequest("liveStream.obsStream", { action: "stop" }),
      });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {managed ? null : accounts.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <LiveDestinationPicker
          accounts={available}
          selected={obs.streaming ? [CONFIGURED_OBS] : selected}
          disabled={feedback.busy || obs.streaming === true}
          onToggle={(key) => {
            setSelected((current) => toggleSelection(current, key));
            feedback.clear();
          }}
        />
      )}
      {destinations.length > 0 ? (
        <LiveDestinationStatus destinations={destinations} overallReason={activity?.reason} />
      ) : null}
      <div>
        {shouldStop ? (
          <Button
            variant="secondary"
            startIcon={activity?.needsPlatformConfirmation ? <Check /> : <Square />}
            disabled={feedback.busy || starting || stopping || !activity}
            disabledReason={t("Wait for the current live stream action to finish.")}
            loading={stopping}
            loadingLabel={t("Stopping…")}
            onClick={stop}
          >
            {activity?.needsPlatformConfirmation
              ? t("Confirm broadcast ended")
              : t("Stop streaming")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            startIcon={<Play />}
            disabled={
              feedback.busy ||
              !activity ||
              live.isError ||
              managed ||
              !obs.configured ||
              requiresManualCredentials ||
              !hasSelection
            }
            disabledReason={
              !obs.configured
                ? t("Set up OBS in step 2 first.")
                : managed
                  ? t("A live stream is already running.")
                  : !hasSelection
                    ? t("Choose where to stream first.")
                    : requiresManualCredentials
                      ? t("Enter the stream key in step 3 first.")
                      : t("Wait for the current live stream action to finish.")
            }
            loading={starting}
            loadingLabel={t("Starting…")}
            onClick={start}
          >
            {picked.length > 1
              ? t("Start streaming to {p0} destinations", { p0: String(picked.length) })
              : t("Start streaming")}
          </Button>
        )}
      </div>
      {accounts.isError ? (
        <InlineError retry={{ onRetry: () => void accounts.refetch().catch(() => undefined) }}>
          {t("Could not load streaming accounts.")}
        </InlineError>
      ) : accounts.data && available.length === 0 ? (
        <InlineMessage>
          {t("Set up a LIVE destination in Social to stream to a connected account.")}
        </InlineMessage>
      ) : null}
      {!managed && hasVerticalAccount(picked) ? (
        <InlineMessage>
          {t(
            "TikTok and Instagram stream from the Aitum Vertical canvas. Install Aitum Vertical in OBS and add one stream output in its settings.",
          )}
        </InlineMessage>
      ) : null}
      {requiresManualCredentials ? (
        <InlineMessage>
          {t(
            "Save a manual server and key under Stream credentials to use the configured OBS server.",
          )}
        </InlineMessage>
      ) : null}
      {live.isError ? (
        <InlineError retry={{ onRetry: () => void live.refetch().catch(() => undefined) }}>
          {t("Could not check broadcast status.")}
        </InlineError>
      ) : live.isPending ? (
        <LoadingText />
      ) : reason ? (
        <InlineMessage tone={activity?.state === "failed" ? "danger" : "warning"}>
          {reason}
        </InlineMessage>
      ) : activity?.state === "streaming" && destinations.length === 0 ? (
        <StatusText tone="done">{t("Streaming")}</StatusText>
      ) : (activity?.state === "starting" && !starting) ||
        (activity?.state === "stopping" && !stopping) ? (
        // The pressed action already shows this progress beside its spinner.
        <StatusText tone="running">
          {activity.state === "starting" ? t("Starting…") : t("Stopping…")}
        </StatusText>
      ) : null}
      {!reason && activity?.state !== "streaming" && feedback.error("live-start", "live-stop") ? (
        <InlineError>
          {t(
            "Could not confirm the broadcast action. Check OBS and the platform before trying again.",
          )}
        </InlineError>
      ) : null}
      {dialog}
    </div>
  );
}
