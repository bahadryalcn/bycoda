import { useState } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import type { LiveGamesStatus } from "../../../shared/model/host-contracts/live-games";
import { Button } from "../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { CircleDot, Play } from "../../../shared/ui/icons";
import { liveGamesRequest } from "../model/liveGamesClient";
import type { LiveGamesFeedback } from "../hooks/useLiveGames";

const connectionLabel = {
  idle: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  error: "Connection failed",
} as const;
const connectionTone: Record<LiveGamesStatus["connection"]["status"], StatusTextTone> = {
  idle: "idle",
  connecting: "running",
  connected: "done",
  reconnecting: "running",
  offline: "needs-you",
  error: "failed",
};

export function LiveGameConnection({
  status,
  feedback,
}: {
  status: LiveGamesStatus;
  feedback: LiveGamesFeedback;
}) {
  const t = useT();
  const { formatNumber } = useFormat();
  const [channelDraft, setChannelDraft] = useState<string>();
  const { connection, snapshot } = status;
  const channel = channelDraft ?? (connection.platform === "tiktok" ? connection.channel : "");
  const connected = ["connecting", "connected", "reconnecting"].includes(connection.status);
  const detail = feedback.error("connect", "disconnect", "demo");

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t("Live source")}>
      <SectionLabel>{t("Live source")}</SectionLabel>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusText tone={connectionTone[connection.status]}>
          {connection.platform === "demo" && connected ? t("Demo running") : t(connectionLabel[connection.status])}
        </StatusText>
        {connected ? (
          <Text size="caption" tone="secondary">
            {t("{p0} dancing · {p1} watching", {
              p0: formatNumber(snapshot.dancers.length),
              p1: formatNumber(snapshot.viewers),
            })}
          </Text>
        ) : null}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (connected || feedback.busy || !channel.trim()) return;
          feedback.run({
            action: "connect",
            request: () => liveGamesRequest("liveGames.start", { channel }),
            applied: () => setChannelDraft(undefined),
          });
        }}
      >
        <TextField
          label={t("TikTok channel")}
          placeholder="@kanal"
          value={channel}
          disabled={connected || feedback.busy}
          onChange={(event) => { feedback.clear(); setChannelDraft(event.target.value); }}
          maxLength={2048}
          autoComplete="off"
        />
        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <Button
              variant="secondary"
              disabled={feedback.busy}
              loading={feedback.pending("disconnect")}
              onClick={() => feedback.run({ action: "disconnect", request: () => liveGamesRequest("liveGames.stop", {}) })}
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
            variant="secondary"
            startIcon={<Play />}
            disabled={connected || feedback.busy}
            loading={feedback.pending("demo")}
            onClick={() => feedback.run({ action: "demo", request: () => liveGamesRequest("liveGames.demo", {}) })}
          >
            {t("Run demo")}
          </Button>
        </div>
      </form>
      {detail ? <InlineError details={detail}>{t("Could not update the live source")}</InlineError> : null}
      {connection.detail ? <InlineMessage tone="neutral">{t(connection.detail)}</InlineMessage> : null}
    </section>
  );
}
