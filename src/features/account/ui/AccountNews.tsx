import { surfaceAttributes } from "../../../shared/ui/Surface";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { AccountExternalLink } from "./AccountExternalLink";
import { t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useAnnouncementFeed } from "../hooks/useAnnouncements";
import styles from "./account.module.css";

const RECENT = 5;

/** Recent announcements, dismissed ones included. The feed is kept fresh by the workspace notices. */
export function AccountNews() {
  useLocale();
  const recent = [...useAnnouncementFeed().items]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, RECENT);
  return (
    <section className={styles.section} aria-labelledby="account-news">
      <SectionLabel labelId="account-news">{t("News")}</SectionLabel>
      {recent.length === 0 ? (
        <EmptyState size="inline" kind="empty" description={t("No announcements right now.")} />
      ) : null}
      <ul {...surfaceAttributes({ dividers: "pane" }, styles.rows)}>
        {recent.map((item) => (
          <li key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <Text
                as="strong"
                size="body"
                tone="inherit"
                leading="inherit"
                className={styles.rowTitle}
              >
                {item.title}
              </Text>
              <Text size="caption" tone="secondary" leading="inherit">
                {formatRelativeTime(Date.parse(item.publishedAt))}
              </Text>
              <Text as="p" size="body" tone="secondary" className={styles.lead}>
                {item.body}
              </Text>
            </div>
            {item.url ? <AccountExternalLink url={item.url} label={t("Read more")} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
