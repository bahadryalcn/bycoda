import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Star } from "../../../shared/ui/icons";
import { Switch } from "../../../shared/ui/Switch";
import { bookmarkServerActivity, type ServerRecord } from "../model/serverInventory";

/** Metadata only. Never receives or stores terminal command/output contents. */
export function ServerActivity({
  server,
  expanded = false,
}: {
  server: ServerRecord;
  expanded?: boolean;
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const activity = server.metadata.activity ?? [];
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const visibleActivity = activity.filter((event) => !bookmarkedOnly || event.bookmarked);
  const Container = expanded ? "section" : "details";
  const Heading = expanded ? "h3" : "summary";
  return (
    <Container className="text-xs">
      <Heading className="py-1 font-medium">
        {t("Connection activity")} ({activity.length})
      </Heading>
      <div className="my-3">
        <Switch
          label={t("Bookmarked only")}
          checked={bookmarkedOnly}
          onCheckedChange={setBookmarkedOnly}
        />
      </div>
      <details className="mbs-2 text-(--ui-text-muted)">
        <summary className="cursor-pointer">{t("About connection activity")}</summary>
        <p className="mbs-2">{t("Launch metadata only. Terminal contents are not recorded.")}</p>
      </details>
      {error ? (
        <p className="mbs-2 text-(--ui-tone-danger-fg)" role="alert">
          {error}
        </p>
      ) : null}
      {!visibleActivity.length ? (
        <p className="py-4 text-(--ui-text-muted)">
          {t(bookmarkedOnly ? "No bookmarked activity." : "No connection activity yet.")}
        </p>
      ) : (
        <ul className="mbs-2 max-h-80 overflow-y-auto">
          {[...visibleActivity].reverse().map((event) => (
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
                <Star className="icon-sm" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
