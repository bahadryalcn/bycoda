import { Text } from "../../../shared/ui/Text";
import { AccountExternalLink } from "./AccountExternalLink";
import { t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { Group, Row, SettingsFeedback } from "../../settings/public/settingsControls";
import { useAnnouncementFeed } from "../hooks/useAnnouncements";

const RECENT = 5;

/** Recent announcements, dismissed ones included. The feed is kept fresh by the workspace notices. */
export function AccountNews() {
  useLocale();
  const recent = [...useAnnouncementFeed().items]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, RECENT);
  return (
    <Group title={t("News")}>
      {recent.length === 0 ? (
        <SettingsFeedback state="empty">{t("No announcements right now.")}</SettingsFeedback>
      ) : null}
      {recent.map((item) => (
        <Row key={item.id} label={item.title} descriptionVisible description={item.body}>
          <Text size="caption" tone="secondary">
            {formatRelativeTime(Date.parse(item.publishedAt))}
          </Text>
          {item.url ? <AccountExternalLink url={item.url} label={t("Read more")} /> : null}
        </Row>
      ))}
    </Group>
  );
}
