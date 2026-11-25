import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { formatNumber, t } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Timestamp } from "../../../shared/ui/Timestamp";
import {
  useRemoteLifecycle,
  type ConnectionPhase,
  type RemoteFeature,
} from "../model/remoteLifecycle";
import { connectionIndicator, type RemoteConnectionStatus } from "../model/remoteConnection";

const phaseLabel = (phase: ConnectionPhase) =>
  ({
    idle: t("Not checked"),
    checking: t("Checking Host"),
    restoring: t("Refreshing remote data"),
    ready: t("Host verified"),
    waiting: t("Waiting for you"),
    failed: t("Connection failed"),
  })[phase];
const featureLabel = (feature: RemoteFeature) =>
  ({
    host: t("Host"),
    changes: t("Live updates"),
    files: t("Files"),
    git: t("Git"),
    sessions: t("Sessions"),
  })[feature];
const reasonLabel = (reason: RemoteConnectionStatus) => {
  const { tone } = connectionIndicator({ status: reason }, false);
  return tone === "connected"
    ? t("Connected")
    : tone === "connecting"
      ? t("Connecting")
      : t("Not connected");
};

/** Bounded metadata only. No addresses, credentials, commands or terminal output. */
export function RemoteConnectionDetails({ environmentId }: { environmentId: string }) {
  const lifecycle = useRemoteLifecycle(environmentId);
  const [now, setNow] = useState<number>();
  const ticking = lifecycle.phase === "checking" || lifecycle.nextRetryAt != null;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return (
    <Text as="div" tone="inherit" className="flex min-w-0 flex-col gap-2">
      <Text as="p" size="inherit" tone="muted">
        {/* Only the phase is live: it changes on real transitions, not every tick. */}
        <LiveText
          text={lifecycle.paused ? t("Automatic reconnect paused") : phaseLabel(lifecycle.phase)}
        />
        {lifecycle.phase === "checking" && lifecycle.startedAt != null && now != null ? (
          <span className="tabular-nums">
            {" "}
            ·{" "}
            {t("{p0}s elapsed", {
              p0: formatNumber(Math.max(0, Math.floor((now - lifecycle.startedAt) / 1_000))),
            })}
          </span>
        ) : null}
        {lifecycle.nextRetryAt != null && now != null ? (
          <span className="tabular-nums">
            {" "}
            ·{" "}
            {t("Retry in {p0}s", {
              p0: formatNumber(Math.max(0, Math.ceil((lifecycle.nextRetryAt - now) / 1_000))),
            })}
          </span>
        ) : null}
      </Text>
      <DescriptionList size="sm">
        {(
          Object.entries(lifecycle.features) as [
            RemoteFeature,
            NonNullable<typeof lifecycle.features.host>,
          ][]
        ).map(([feature, health]) => (
          <DescriptionItem key={feature} term={featureLabel(feature)}>
            <span>
              {health.status === "ready"
                ? t("Up to date")
                : health.status === "stale"
                  ? t("Refresh pending")
                  : t("Unavailable")}
            </span>
            {health.verifiedAt != null ? (
              <>
                <span> · </span>
                <Timestamp value={health.verifiedAt} />
              </>
            ) : null}
          </DescriptionItem>
        ))}
      </DescriptionList>
      <Disclosure
        size="sm"
        summary={
          <>
            {t("Connection history")} ({lifecycle.activity.length})
          </>
        }
      >
        <ol className="max-h-48 overflow-y-auto">
          {[...lifecycle.activity].reverse().map((event, index) => (
            <li
              key={`${event.generation}-${event.attempt}-${event.at}-${index}`}
              className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-1"
            >
              <span>
                {phaseLabel(event.phase)} <span className="tabular-nums">#{event.attempt}</span>
                {event.reason ? ` · ${reasonLabel(event.reason)}` : ""}
              </span>
              <Timestamp value={event.at} tone="muted" />
            </li>
          ))}
        </ol>
      </Disclosure>
    </Text>
  );
}
