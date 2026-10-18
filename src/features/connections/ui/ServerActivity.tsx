import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Star } from "../../../shared/ui/icons";
import { bookmarkServerActivity, type ServerRecord } from "../model/serverInventory";

/** Metadata only. Never receives or stores terminal command/output contents. */
export function ServerActivity({ server }: { server: ServerRecord }) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const activity = server.metadata.activity ?? [];
  return (
    <details className="mbs-3 border-t border-stroke pbs-3 text-xs">
      <summary className="cursor-pointer text-(--ui-text-muted)">
        {t("Connection activity")} ({activity.length})
      </summary>
      <p className="mbs-2 text-(--ui-text-muted)">
        {t("Launch metadata only. Terminal contents are not recorded.")}
      </p>
      {error ? (
        <p className="mbs-2 text-(--ui-tone-danger-fg)" role="alert">
          {error}
        </p>
      ) : null}
      {!activity.length ? (
        <p className="mbs-2 text-(--ui-text-muted)">{t("No connection activity yet.")}</p>
      ) : (
        <ul className="mbs-2 max-h-48 overflow-y-auto">
          {[...activity].reverse().map((event) => (
            <li key={event.id} className="flex min-w-0 items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <p>{t("Terminal opened")}</p>
                <Timestamp value={event.at} className="text-(--ui-text-muted)" />
              </div>
              <Button
                variant="ghost"
                iconOnly
                selected={event.bookmarked}
                aria-pressed={event.bookmarked}
                label={t(event.bookmarked ? "Remove bookmark" : "Bookmark")}
                disabled={pending != null}
                loading={pending === event.id}
                onClick={async () => {
                  if (pending != null) return;
                  setPending(event.id);
                  setError("");
                  try {
                    await bookmarkServerActivity(server.id, event.id, !event.bookmarked);
                  } catch {
                    setError(t("Couldn’t update activity bookmark."));
                  } finally {
                    setPending(undefined);
                  }
                }}
              >
                <Star className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
