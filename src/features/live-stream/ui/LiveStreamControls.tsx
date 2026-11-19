import { useState } from "react";
import { useT } from "../../../shared/i18n";
import type {
  LiveStreamLiveAccount,
  LiveStreamLiveStatus,
  LiveStreamStatus,
} from "../../../shared/model/host-contracts/live-stream";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Check, Play, Square } from "../../../shared/ui/icons";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { StatusText } from "../../../shared/ui/StatusText";
import type {
  LiveStreamAccountsQuery,
  LiveStreamFeedback,
  LiveStreamLiveQuery,
} from "../hooks/useLiveStream";
import { liveStreamRequest } from "../model/liveStreamClient";

const configuredObs = "__configured-obs__";
const platformNames: Record<LiveStreamLiveAccount["platform"], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
};

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
  const [selected, setSelected] = useState(configuredObs);
  const available = accounts.data?.accounts ?? [];
  const account = available.find((entry) => entry.accountId === selected);
  const activity = live.data;
  const activeAccount = available.find((entry) => entry.accountId === activity?.accountId);
  const managed = Boolean(
    activity?.canStop || activity?.state === "starting" || activity?.state === "stopping",
  );
  const stopping =
    activity?.state === "stopping" || feedback.pending("live-stop") || feedback.pending("obs-stop");
  const starting =
    activity?.state === "starting" ||
    feedback.pending("live-start") ||
    feedback.pending("obs-start");
  const liveDestination = activity?.platform
    ? activeAccount
      ? accountLabel(activeAccount, t)
      : platformNames[activity.platform]
    : undefined;
  const shouldStop = Boolean(activity?.canStop || obs.streaming);
  const requiresManualCredentials =
    selected === configuredObs && activity?.managedDestination && !managed && !obs.streaming;
  const targetOptions = [
    ...available.map((entry) => ({ value: entry.accountId, label: accountLabel(entry, t) })),
    { value: configuredObs, label: t("Configured OBS server") },
  ];
  const applicable = activity?.accountId === selected || managed;
  const reason = applicable && activity ? streamReason(activity.reason, t) : undefined;

  const start = () => {
    if (account) {
      void confirm({
        title: t("Start streaming"),
        message: t("OBS will broadcast {p0} to {p1}.", {
          p0: obs.scene ?? t("Scene"),
          p1: accountLabel(account, t),
        }),
        confirmLabel: t("Start streaming"),
        danger: false,
        onConfirm: () => {
          feedback.run({
            action: "live-start",
            requestLive: () =>
              liveStreamRequest("liveStream.live.start", {
                accountId: account.accountId,
                scene: obs.scene,
              }),
          });
        },
      }).catch(() => undefined);
      return;
    }
    if (selected !== configuredObs) return;
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
        context: liveDestination,
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
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <SearchableSelect
            label={t("Stream to")}
            value={managed ? (activity?.accountId ?? "") : obs.streaming ? configuredObs : selected}
            placeholder={liveDestination ?? t("Choose an account")}
            options={targetOptions}
            onChange={(value) => {
              setSelected(value);
              feedback.clear();
            }}
            loading={accounts.isPending}
            disabled={feedback.busy || managed || obs.streaming}
          />
        </div>
        {shouldStop ? (
          <Button
            variant="secondary"
            startIcon={activity?.needsPlatformConfirmation ? <Check /> : <Square />}
            disabled={feedback.busy || starting || stopping || !activity}
            loading={stopping}
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
              (!account && selected !== configuredObs)
            }
            loading={starting}
            onClick={start}
          >
            {t("Start streaming")}
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
      ) : activity?.state === "streaming" && liveDestination ? (
        <StatusText tone="done">{t("Streaming to {p0}", { p0: liveDestination })}</StatusText>
      ) : activity?.state === "starting" || activity?.state === "stopping" ? (
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

function accountLabel(account: LiveStreamLiveAccount, t: ReturnType<typeof useT>) {
  return t("{p0} · {p1}", { p0: platformNames[account.platform], p1: account.label });
}

function streamReason(reason: LiveStreamLiveStatus["reason"], t: ReturnType<typeof useT>) {
  switch (reason) {
    case "OBS_NOT_CONFIGURED":
      return t("Set up OBS before starting a broadcast.");
    case "OBS_UNAVAILABLE":
      return t("Open OBS and check its WebSocket connection.");
    case "OBS_ALREADY_STREAMING":
      return t("Stop the current OBS stream before switching accounts.");
    case "SCENE_NOT_FOUND":
      return t("The selected scene could not be found in OBS.");
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
  }
}
