import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import type { InstagramEarnings, InstagramEarningsKind } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

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
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
  const [snapshot, setSnapshot] = useState<InstagramEarnings>();
  const read = () => {
    void write("earnings", async () => {
      setSnapshot(undefined);
      setSnapshot(await client.browserInstagramEarnings(accountId));
    }).catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Instagram earnings")} disabled={disabled}>
      <Button size="sm" variant="secondary" loading={is("earnings")} onClick={read}>
        {t("Read Instagram earnings")}
      </Button>
      {snapshot?.values.length ? (
        <ul>
          {snapshot.values.map(({ kind, amount }) => (
            <li key={kind}>
              <Text>
                {earningsLabel(kind)} · {amount}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </FieldGroup>
  );
}
