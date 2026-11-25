import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Text } from "../../../../../shared/ui/Text";
import type { InstagramEarnings, InstagramEarningsKind } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

function earningsLabel(kind: InstagramEarningsKind) {
  switch (kind) {
    case "total":
      return t("Total earnings");
    case "estimated":
      return t("Estimated earnings");
    case "available":
      return t("Available for payout");
    case "pending":
      return t("Pending payout");
    case "last":
      return t("Last payout");
  }
}

export function InstagramEarningsPanel({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const { write, is, error, details } = useAccountWrite(
    t("Instagram could not complete this action."),
  );
  const [snapshot, setSnapshot] = useState<InstagramEarnings>();
  const read = () => {
    void write("earnings", async () => {
      setSnapshot(undefined);
      setSnapshot(await client.browserInstagramEarnings(accountId));
    }).catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Instagram earnings")} hideLegend disabled={disabled}>
      <div className="instagram-head">
        <Text size="caption" tone="secondary">
          {t("Read from the Instagram monetization page in your browser.")}
        </Text>
        <Button size="sm" variant="secondary" loading={is("earnings")} onClick={read}>
          {snapshot ? t("Refresh") : t("Read Instagram earnings")}
        </Button>
      </div>
      {is("earnings") && !snapshot ? <LoadingText /> : null}
      {snapshot?.values.length ? (
        <DescriptionList size="sm">
          {snapshot.values.map(({ kind, amount }) => (
            <DescriptionItem key={kind} term={earningsLabel(kind)}>
              {amount}
            </DescriptionItem>
          ))}
        </DescriptionList>
      ) : null}
      {snapshot && !snapshot.values.length ? (
        <EmptyState size="inline" context="list" title={t("Earnings unavailable")} />
      ) : null}
      {error ? <InlineError details={details}>{error}</InlineError> : null}
    </FieldGroup>
  );
}
