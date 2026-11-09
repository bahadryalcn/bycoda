import type { Announcement } from "@bycoda/account-contracts";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Toast, type ToastTone } from "../../../shared/ui/ToastRegion";
import { useAnnouncementFeed, useAnnouncementPolling } from "../hooks/useAnnouncements";
import { announcementFeed, unseenAnnouncements } from "../model/announcementFeed";

const MAX_SHOWN = 3;
const TONE: Record<Announcement["severity"], ToastTone> = {
  info: "info",
  warning: "warning",
  critical: "danger",
};

/**
 * Non-blocking notices for announcements the signed-in user has not dismissed. Mounted once
 * with the workspace notices: it also keeps the feed fresh. Guests get nothing.
 */
export function AnnouncementNotices() {
  useLocale();
  useAnnouncementPolling();
  const snapshot = useAnnouncementFeed();
  return unseenAnnouncements(snapshot)
    .slice(0, MAX_SHOWN)
    .map((item) => (
      <Toast
        key={item.id}
        tone={TONE[item.severity]}
        title={item.title}
        message={item.body}
        durationMs={null}
        width="lg"
        action={{ label: t("Dismiss"), onClick: () => announcementFeed.dismiss(item.id) }}
        actionsPlacement="footer"
        actions={
          item.url ? (
            <Button
              variant="secondary"
              onClick={() => {
                openExternal(item.url!).catch(() => undefined); // -- an unopenable link leaves the notice in place.
              }}
            >
              {t("Read more")}
            </Button>
          ) : undefined
        }
        onDismiss={() => announcementFeed.dismiss(item.id)}
      />
    ));
}
