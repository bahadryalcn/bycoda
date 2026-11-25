import { Text } from "../../../shared/ui/Text";
import type { EntitlementsSummary, User } from "@bycoda/account-contracts";
import { useState } from "react";
import { dateTimeFormat, getLocale, t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Button } from "../../../shared/ui/Button";
import { InlineEdit } from "../../../shared/ui/InlineEdit";
import { InlineError } from "../../../shared/ui/InlineError";
import { Group, Row } from "../../../shared/ui/settings";
import { localTimeZone, useProfileUpdate } from "../hooks/useAccountData";

export function planLabel(tier: EntitlementsSummary["planTier"]): string {
  switch (tier) {
    case "individual":
      return t("Personal");
    case "team":
      return t("Team");
    case "enterprise":
      return t("Enterprise");
  }
}

export function memberSince(user: Pick<User, "createdAt">): string {
  return dateTimeFormat(getLocale(), { dateStyle: "long" }).format(new Date(user.createdAt));
}

/** Editable profile facts: name, membership and the account's time zone (identity lives in the header). */
export function AccountProfile({ user }: { user: User }) {
  useLocale();
  const update = useProfileUpdate();
  const [zoneError, setZoneError] = useState("");
  const here = localTimeZone();

  const useHere = () => {
    setZoneError("");
    update.mutateAsync({ timeZone: here }).catch((error) => setZoneError(errorText(error)));
  };

  return (
    <>
      <Group
        title={t("Profile")}
        description={t("How you appear in bycoda and in account e-mails.")}
      >
        <Row label={t("Display name")}>
          <InlineEdit
            label={t("Display name")}
            variant="body"
            value={user.displayName}
            validate={(next) => (next.trim() ? null : t("Enter a name."))}
            onSave={(next) => update.mutateAsync({ displayName: next.trim() })}
          />
        </Row>
        <Row label={t("Member since")}>
          <Text size="body" tone="muted">
            {memberSince(user)}
          </Text>
        </Row>
      </Group>
      <Group
        title={t("Region")}
        description={t("Daily summaries and active-time days follow this time zone.")}
        feedback={
          zoneError ? (
            <InlineError details={zoneError}>{t("Could not save the time zone.")}</InlineError>
          ) : undefined
        }
      >
        <Row
          label={t("Time zone")}
          description={
            user.timeZone === here ? t("Same as this computer.") : t("Differs from this computer.")
          }
        >
          <span className="flex items-center gap-2">
            <Text size="body" tone="muted">
              {user.timeZone}
            </Text>
            {user.timeZone !== here ? (
              <Button variant="secondary" size="sm" loading={update.isPending} onClick={useHere}>
                {t("Use {p0}", { p0: here })}
              </Button>
            ) : null}
          </span>
        </Row>
      </Group>
    </>
  );
}
