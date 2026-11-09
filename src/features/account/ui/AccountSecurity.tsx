import type { User } from "@bycoda/account-contracts";
import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { Timeline } from "../../../shared/ui/Timeline";
import { Clock } from "../../../shared/ui/icons";
import { Group, Row } from "../../settings/public/settingsControls";
import { useDevices, useSecurityActivity } from "../hooks/useAccountData";
import { securityUrl } from "../model/accountPortal";
import {
  securityEventMeta,
  securityEventTitle,
  securityEventTone,
  signInMethodLabel,
} from "../model/securityActivity";

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
      <Row label={t("Events")} stacked>
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
      </Row>
    </Group>
  );
}

/**
 * Sign-in security owned by bycoda: the e-mail and sign-in methods, the signed-in devices with a
 * sign-out-everywhere action, and the account's own activity log. Password and two-step
 * settings belong to the sign-in provider and open on the web when a portal is configured.
 */
export function AccountSecurity({
  user,
  onShowDevices,
}: {
  user: User;
  onShowDevices: () => void;
}) {
  useLocale();
  const { query, revokeOthers } = useDevices();
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState("");
  const url = securityUrl();
  const active = query.data?.filter((device) => !device.revokedAt) ?? [];

  const signOutOthers = async () => {
    const ok = await confirm({
      title: t("Sign out of all other devices?"),
      message: t(
        "Every device except this computer will be signed out of your bycoda account the next time it connects.",
      ),
      confirmLabel: t("Sign out others"),
      pendingLabel: t("Signing out…"),
    });
    if (!ok) return;
    setError("");
    try {
      await revokeOthers.mutateAsync();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <>
      <Group
        title={t("Sign-in")}
        description={t("bycoda never sees your password; your sign-in provider checks it.")}
        feedback={error ? <InlineError>{error}</InlineError> : undefined}
      >
        <Row label={t("E-mail")}>
          <PrivateEmail email={user.email} />
        </Row>
        <Row
          label={t("Sign-in methods")}
          description={t("Any of these opens your account on a new device.")}
        >
          {user.signInMethods.length ? (
            <BadgeList
              label={t("Sign-in methods")}
              items={user.signInMethods.map((method) => ({
                id: method,
                label: signInMethodLabel(method),
              }))}
            />
          ) : (
            <span className="text-ui-body text-muted">{t("None recorded")}</span>
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
      <Group title={t("Sessions")} description={t("Devices that can use your account right now.")}>
        <Row
          label={t("Signed-in devices")}
          description={
            query.data
              ? t("{p0} active", { p0: active.length })
              : query.isError
                ? t("Could not load your devices.")
                : t("Loading devices…")
          }
        >
          <Button variant="secondary" size="sm" onClick={onShowDevices}>
            {t("Review devices")}
          </Button>
        </Row>
        {active.length > 1 ? (
          <Row
            label={t("Sign out everywhere else")}
            description={t("Keeps this computer signed in.")}
          >
            <Button
              variant="secondary"
              size="sm"
              loading={revokeOthers.isPending}
              onClick={() => signOutOthers().catch(() => undefined)}
            >
              {t("Sign out others")}
            </Button>
          </Row>
        ) : null}
      </Group>
      <SecurityActivity />
      {dialog}
    </>
  );
}
