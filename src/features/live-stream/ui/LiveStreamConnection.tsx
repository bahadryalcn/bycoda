import { useState } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import type { LiveStreamStatus } from "../../../shared/model/host-contracts/live-stream";
import { Button } from "../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { CircleDot, Play } from "../../../shared/ui/icons";
import { liveStreamRequest } from "../model/liveStreamClient";
import type { LiveStreamFeedback } from "../hooks/useLiveStream";
import { LiveSection } from "./LiveSection";

const connectionLabel = {
  idle: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  error: "Connection failed",
} as const;
const connectionTone: Record<LiveStreamStatus["connection"]["status"], StatusTextTone> = {
  idle: "idle",
  connecting: "running",
  connected: "done",
  reconnecting: "running",
  offline: "needs-you",
  error: "failed",
};

/** Step 1: connect a TikTok channel or run the demo. */
export function LiveStreamConnection({
  status,
  feedback,
}: {
  status: LiveStreamStatus;
  feedback: LiveStreamFeedback;
}) {
  const t = useT();
  const { formatNumber } = useFormat();
  const [channelDraft, setChannelDraft] = useState<string>();
  const { connection, snapshot } = status;
  const channel = channelDraft ?? (connection.platform === "tiktok" ? connection.channel : "");
  const connected = ["connecting", "connected", "reconnecting"].includes(connection.status);
  const detail = feedback.error("connect", "disconnect", "demo");

  return (
    <LiveSection
      step={1}
      title={t("Live source")}
      status={
        <StatusText tone={connectionTone[connection.status]}>
          {connection.platform === "demo" && connected
            ? t("Demo running")
            : t(connectionLabel[connection.status])}
        </StatusText>
      }
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (connected || feedback.busy || !channel.trim()) return;
          feedback.run({
            action: "connect",
            request: () => liveStreamRequest("liveStream.start", { channel }),
            applied: () => setChannelDraft(undefined),
          });
        }}
      >
        <div className="min-w-48 flex-1">
          <TextField
            label={t("TikTok channel")}
            placeholder="@kanal"
            value={channel}
            disabled={connected || feedback.busy}
            onChange={(event) => {
              feedback.clear();
              setChannelDraft(event.target.value);
            }}
            maxLength={2048}
            autoComplete="off"
          />
        </div>
        {connected ? (
          <Button
            variant="secondary"
            disabled={feedback.busy}
            loading={feedback.pending("disconnect")}
            onClick={() =>
              feedback.run({
                action: "disconnect",
                request: () => liveStreamRequest("liveStream.stop", {}),
              })
            }
          >
            {t("Disconnect")}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            startIcon={<CircleDot />}
            disabled={feedback.busy || !channel.trim()}
            loading={feedback.pending("connect")}
          >
            {t("Connect")}
          </Button>
        )}
        <Button
          variant="ghost"
          startIcon={<Play />}
          disabled={connected || feedback.busy}
          loading={feedback.pending("demo")}
          onClick={() =>
            feedback.run({
              action: "demo",
              request: () => liveStreamRequest("liveStream.demo", {}),
            })
          }
        >
          {t("Run demo")}
        </Button>
      </form>
      {connected ? (
        <Text size="caption" tone="secondary">
          {t("{p0} watching", { p0: formatNumber(snapshot.viewers) })}
        </Text>
      ) : null}
      {detail ? (
        <InlineError details={detail}>{t("Could not update the live source")}</InlineError>
      ) : null}
      {connection.detail ? (
        <InlineMessage tone="neutral">{t(connection.detail)}</InlineMessage>
      ) : null}
    </LiveSection>
  );
}
