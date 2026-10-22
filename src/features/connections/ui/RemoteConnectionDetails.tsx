import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { Timestamp } from "../../../shared/ui/Timestamp";
import {
  useRemoteLifecycle,
  type ConnectionPhase,
  type RemoteFeature,
} from "../model/remoteLifecycle";
import { connectionIndicator } from "../model/remoteConnection";

const phases: Record<ConnectionPhase, string> = {
  idle: "Not checked",
  checking: "Checking Host",
  restoring: "Refreshing remote data",
  ready: "Host verified",
  waiting: "Waiting for you",
  failed: "Connection failed",
};
const features: Record<RemoteFeature, string> = {
  host: "Host",
  changes: "Live updates",
  files: "Files",
  git: "Git",
  sessions: "Sessions",
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
    <div className="flex min-w-0 flex-col gap-2 text-xs">
      <p role="status" className="text-(--ui-text-muted)">
        {t(phases[lifecycle.phase])}
        {lifecycle.phase === "checking" && lifecycle.startedAt != null && now != null ? (
          <span className="tabular-nums">
            {" "}
            ·{" "}
            {t("{seconds}s elapsed", {
              seconds: Math.max(0, Math.floor((now - lifecycle.startedAt) / 1_000)),
            })}
          </span>
        ) : null}
        {lifecycle.nextRetryAt != null && now != null ? (
          <span className="tabular-nums">
            {" "}
            ·{" "}
            {t("Retry in {seconds}s", {
              seconds: Math.max(0, Math.ceil((lifecycle.nextRetryAt - now) / 1_000)),
            })}
          </span>
        ) : null}
      </p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        {(
          Object.entries(lifecycle.features) as [
            RemoteFeature,
            NonNullable<typeof lifecycle.features.host>,
          ][]
        ).map(([feature, health]) => (
          <div key={feature} className="contents">
            <dt>{t(features[feature])}</dt>
            <dd className="text-end text-(--ui-text-muted)">
              <span>
                {t(
                  health.status === "ready"
                    ? "Up to date"
                    : health.status === "stale"
                      ? "Refresh pending"
                      : "Unavailable",
                )}
              </span>
              {health.verifiedAt != null ? (
                <>
                  <span> · </span>
                  <Timestamp value={health.verifiedAt} />
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary className="cursor-pointer py-1">
          {t("Connection history")} ({lifecycle.activity.length})
        </summary>
        <ol className="max-h-48 overflow-y-auto">
          {[...lifecycle.activity].reverse().map((event, index) => (
            <li
              key={`${event.generation}-${event.attempt}-${event.at}-${index}`}
              className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-1"
            >
              <span>
                {t(phases[event.phase])} <span className="tabular-nums">#{event.attempt}</span>
                {event.reason
                  ? ` · ${t(connectionIndicator({ status: event.reason }, false).label)}`
                  : ""}
              </span>
              <Timestamp value={event.at} className="text-(--ui-text-muted)" />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
