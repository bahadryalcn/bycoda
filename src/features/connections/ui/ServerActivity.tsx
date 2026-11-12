import { Text } from "../../../shared/ui/Text";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useState } from "react";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
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
  const title = (
    <>
      {t("Connection activity")} ({activity.length})
    </>
  );
  const content = (
    <>
      <div className="my-3">
        <Switch
          label={t("Bookmarked only")}
          checked={bookmarkedOnly}
          onCheckedChange={setBookmarkedOnly}
        />
      </div>
      <Text as="p" size="inherit" tone="muted" className="mbs-2">
        {t("Launch metadata only. Terminal contents are not recorded.")}
      </Text>
      {error ? <InlineError className="mbs-2">{error}</InlineError> : null}
      {!visibleActivity.length ? (
        <EmptyState
          size="inline"
          kind={bookmarkedOnly ? "filtered" : undefined}
          description={t(
            bookmarkedOnly ? "No bookmarked activity." : "No connection activity yet.",
          )}
          onReset={bookmarkedOnly ? () => setBookmarkedOnly(false) : undefined}
        />
      ) : (
        <ul className="mbs-2 max-h-80 overflow-y-auto">
          {[...visibleActivity].reverse().map((event) => (
            <li key={event.id} className="flex min-w-0 items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <p>{t("Terminal opened")}</p>
                <Timestamp value={event.at} tone="muted" />
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
    </>
  );
  return expanded ? (
    <Text as="section" size="caption" tone="inherit">
      <SectionLabel as="h3">{title}</SectionLabel>
      {content}
    </Text>
  ) : (
    <Disclosure size="sm" textSize="caption" summary={title}>
      <Text as="div" size="caption" tone="inherit">
        {content}
      </Text>
    </Disclosure>
  );
}
