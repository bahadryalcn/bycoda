import { useRemoteConnection } from "../model/useRemoteConnection";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { RemoteLoadError } from "./RemoteLoadError";
import { useRemoteConnectionFeedback } from "./RemoteConnectionFeedback";

/** Above a remote project's session: why the machine is out of reach and how to
 * reconnect, in the same card the Changes panel and file tree use. Shows
 * nothing while the machine is connected. */
export function RemoteConnectionBanner({ cwd, stale = false }: { cwd: string; stale?: boolean }) {
  useLocale();
  const { status, error, lastSeen, reconnecting } = useRemoteConnection(cwd);
  const shared = useRemoteConnectionFeedback(cwd);
  // Not knowing yet is not a problem to report.
  if (shared || status === "connected" || (status === "connecting" && !reconnecting)) return null;
  const since = lastSeen
    ? t(" Last connected at {p0}.", {
        p0: new Date(lastSeen).toLocaleTimeString(getLocale(), {
          hour: "2-digit",
          minute: "2-digit",
        }),
      })
    : "";
  return (
    <div className="shrink-0 px-2 py-1">
      <RemoteLoadError
        cwd={cwd}
        stale={stale}
        compact
        failure={{
          kind:
            status === "outdated-host"
              ? "outdated"
              : status === "identity-mismatch"
                ? "identity"
                : "unreachable",
          message: `${error ?? t("Reconnecting…")}${since}`,
        }}
      />
    </div>
  );
}
