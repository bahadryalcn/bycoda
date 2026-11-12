import sectionStyles from "./accountSections.module.css";
import { Text } from "../../../shared/ui/Text";
import type { DataSummary, RetentionKey } from "@bycoda/account-contracts";
import { useState } from "react";
import { dateTimeFormat, getLocale, t, useLocale } from "../../../shared/i18n";
import { formatDays, formatDuration } from "../../../shared/i18n/format";
import { errorText } from "../../../shared/lib/errors";
import { Button } from "../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Group, Row } from "../../settings/public/settingsControls";
import { useDataExport, useDataSummary } from "../hooks/useAccountData";
import { AccountPrivacy } from "./AccountPrivacy";

export function retentionLabel(key: RetentionKey): string {
  switch (key) {
    case "account_lifetime":
      return t("Kept while your account exists");
    case "deleted_14_days_after_request":
      return t("Deleted 14 days after you ask");
    case "backups_30_days":
      return t("Backups kept 30 days");
    case "expires_7_days_after_request":
      return t("Expires 7 days after the request");
  }
}

const day = (value: string) =>
  dateTimeFormat(getLocale(), { dateStyle: "medium" }).format(new Date(value));

/** One row per stored category: what it holds now and how long it is kept. */
function StoredData({ summary }: { summary: DataSummary }) {
  // The first key is the category's own rule; backups and grace periods apply to all of them.
  const categories = ["profile", "devices", "activity", "notifications", "support"] as const;
  const firstRule = summary.retention.profile[0];
  const commonRule = categories.every((category) => summary.retention[category][0] === firstRule)
    ? firstRule
    : undefined;
  const kept = (keys: readonly RetentionKey[]) =>
    keys[0] && keys[0] !== commonRule ? retentionLabel(keys[0]) : undefined;
  const activity = summary.activity;
  return (
    <>
      <Row label={t("Profile")} description={kept(summary.retention.profile)}>
        <Text size="body" tone="muted">
          {t("Name, e-mail, since {p0}", { p0: day(summary.profile.createdAt) })}
        </Text>
      </Row>
      <Row label={t("Devices")} description={kept(summary.retention.devices)}>
        <Text size="body" tone="muted">
          {t("{p0} active, {p1} signed out", {
            p0: summary.devices.active,
            p1: summary.devices.revoked,
          })}
        </Text>
      </Row>
      <Row label={t("Active time")} description={kept(summary.retention.activity)}>
        <Text size="body" tone="muted">
          {activity.days
            ? t("{p0}, {p1} in total", {
                p0: formatDays(activity.days),
                p1: formatDuration(activity.totalMinutes * 60_000),
              })
            : t("Nothing yet")}
        </Text>
      </Row>
      <Row label={t("Notifications")} description={kept(summary.retention.notifications)}>
        <Text size="body" tone="muted">
          {t("{p0} in your feed", { p0: summary.notifications.feedItems })}
        </Text>
      </Row>
      <Row label={t("Support requests")} description={kept(summary.retention.support)}>
        <Text size="body" tone="muted">
          {summary.support.tickets}
        </Text>
      </Row>
      {commonRule ? (
        <Text as="p" size="caption" tone="secondary" className={sectionStyles.retention}>
          {retentionLabel(commonRule)}
        </Text>
      ) : null}
    </>
  );
}

/** Request a JSON copy of the account, follow it until ready and save it, without leaving the app. */
function DataExportRow() {
  useLocale();
  const { current, follow, request, save } = useDataExport();
  const [error, setError] = useState("");
  const run = (action: () => Promise<unknown>) => {
    setError("");
    action().catch((failure) => setError(errorText(failure)));
  };
  const status = current?.status;
  return (
    <Row
      label={t("Export your data")}
      description={
        status === "pending"
          ? t("Preparing your export…")
          : status === "ready"
            ? t("Ready. The file holds your profile, devices, active time and settings.")
            : status === "failed"
              ? t("The export failed. Try again.")
              : status === "expired"
                ? t("The export expired. Request a new one.")
                : t("A JSON file with everything bycoda stores about your account.")
      }
      feedback={
        error || follow.isError ? (
          <InlineError>{error || t("Could not check the export.")}</InlineError>
        ) : save.isSuccess ? (
          <InlineMessage tone="success">{t("Download started.")}</InlineMessage>
        ) : undefined
      }
    >
      {status === "ready" && current ? (
        <Button
          variant="primary"
          size="sm"
          loading={save.isPending}
          onClick={() => run(() => save.mutateAsync(current))}
        >
          {t("Save file")}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          loading={request.isPending || status === "pending"}
          onClick={() => run(() => request.mutateAsync())}
        >
          {t("Request export")}
        </Button>
      )}
    </Row>
  );
}

/** What bycoda stores about the account, the export, and the device-level privacy choices. */
export function AccountData() {
  useLocale();
  const query = useDataSummary();
  const summary = query.data;
  return (
    <>
      <Group
        title={t("Your data")}
        description={t(
          "bycoda never stores your sessions, prompts, code, file names or project names.",
        )}
        feedback={
          query.isPending ? (
            <LoadingText>{t("Loading your data summary…")}</LoadingText>
          ) : query.isError ? (
            <InlineError retry={{ onRetry: () => query.refetch(), pending: query.isFetching }}>
              {t("Could not load your data summary.")}
            </InlineError>
          ) : undefined
        }
      >
        {summary ? <StoredData summary={summary} /> : null}
        <DataExportRow />
      </Group>
      <AccountPrivacy />
    </>
  );
}
