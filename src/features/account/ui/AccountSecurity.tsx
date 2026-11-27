import { openSettingsSection } from "../../settings/public/settingsLink";
import { Text } from "../../../shared/ui/Text";
import type { User } from "@bycoda/account-contracts";
import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Timeline } from "../../../shared/ui/Timeline";
import { Clock } from "../../../shared/ui/icons";
import { Group, Row } from "../../../shared/ui/settings";
import { useSecurityActivity } from "../hooks/useAccountData";
import { securityUrl } from "../model/accountPortal";
import {
  securityEventMeta,
  securityEventTitle,
  securityEventTone,
  signInMethodLabel,
} from "../model/securityActivity";
import sectionStyles from "./accountSections.module.css";

/** The last 90 days of sign-ins and account changes, newest first, loaded page by page. */
function SecurityActivity() {
  useLocale();
  const query = useSecurityActivity();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const locale = getLocale();
  return (
    <Group
      title={t("Recent activity")}
      description={t("Sign-ins and account changes of the last 90 days. No IP addresses are kept.")}
    >
      <div className={sectionStyles.activity}>
        {query.isPending ? <LoadingText>{t("Loading activity…")}</LoadingText> : null}
        {query.isError ? (
          <InlineError retry={{ onRetry: () => query.refetch(), pending: query.isFetching }}>
            {t("Could not load your account activity.")}
          </InlineError>
        ) : null}
        {query.isSuccess && items.length === 0 ? (
          <EmptyState size="inline" description={t("No account activity in the last 90 days.")} />
        ) : null}
        {items.length > 0 ? (
          <Timeline
            label={t("Recent activity")}
            headingLevel={4}
            events={items.map((item, index) => ({
              id: `${item.at}-${item.kind}-${index}`,
              at: item.at,
              title: securityEventTitle(item.kind),
              meta: securityEventMeta(item, locale) || undefined,
              tone: securityEventTone(item.kind),
              icon: <Clock className="icon-xs" aria-hidden />,
            }))}
          />
        ) : null}
        {query.hasNextPage ? (
          <Button
            variant="ghost"
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage().catch(() => undefined)}
          >
            {t("Show older activity")}
          </Button>
        ) : null}
      </div>
    </Group>
  );
}

/**
 * Sign-in security owned by bycoda: the sign-in methods, the privacy-settings link and the
 * account's own activity log. Password and two-step
 * settings belong to the sign-in provider and open on the web when a portal is configured.
 */
export function AccountSecurity({ user }: { user: User }) {
  useLocale();
  const [error, setError] = useState("");
  const url = securityUrl();

  return (
    <>
      <Group
        title={t("Sign-in")}
        description={t("bycoda never sees your password; your sign-in provider checks it.")}
        feedback={
          error ? (
            <InlineError details={error}>{t("Could not open the account page.")}</InlineError>
          ) : undefined
        }
      >
        <Row label={t("Sign-in methods")}>
          {user.signInMethods.length ? (
            <Text size="body" tone="muted">
              {user.signInMethods.map((method) => signInMethodLabel(method)).join(", ")}
            </Text>
          ) : (
            <Text size="body" tone="muted">
              {t("None recorded")}
            </Text>
          )}
        </Row>
        {url ? (
          <Row
            label={t("Password and two-step verification")}
            description={t("Change them on your account page in the browser.")}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openExternal(url).catch((failure) => setError(errorText(failure)))}
            >
              {t("Open account page")}
            </Button>
          </Row>
        ) : null}
      </Group>
      <Group title={t("Privacy and security")}>
        <Row label={t("Privacy settings")}>
          <Button variant="secondary" size="sm" onClick={() => openSettingsSection("groupLock")}>
            {t("Open settings")}
          </Button>
        </Row>
      </Group>
      <SecurityActivity />
    </>
  );
}
