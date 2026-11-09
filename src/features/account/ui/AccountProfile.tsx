import type { EntitlementsSummary, User } from "@bycoda/account-contracts";
import { useState } from "react";
import { dateTimeFormat, getLocale, t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InlineEdit } from "../../../shared/ui/InlineEdit";
import { InlineError } from "../../../shared/ui/InlineError";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { Group, Row } from "../../settings/public/settingsControls";
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

/** Editable profile facts: name, e-mail, plan, membership and the account's time zone. */
export function AccountProfile({
  user,
  entitlements,
}: {
  user: User;
  entitlements: EntitlementsSummary;
}) {
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
            value={user.displayName}
            validate={(next) => (next.trim() ? null : t("Enter a name."))}
            onSave={(next) => update.mutateAsync({ displayName: next.trim() })}
          />
        </Row>
        <Row
          label={t("E-mail")}
          description={t("Used to sign in and for messages about your account.")}
        >
          <PrivateEmail email={user.email} />
        </Row>
        <Row label={t("Plan")}>
          <Badge tone="accent">{planLabel(entitlements.planTier)}</Badge>
        </Row>
        <Row label={t("Member since")}>
          <span className="text-ui-body text-muted">{memberSince(user)}</span>
        </Row>
      </Group>
      <Group
        title={t("Region")}
        description={t("Daily summaries and active-time days follow this time zone.")}
        feedback={zoneError ? <InlineError>{zoneError}</InlineError> : undefined}
      >
        <Row
          label={t("Time zone")}
          description={
            user.timeZone === here ? t("Same as this computer.") : t("Differs from this computer.")
          }
        >
          <span className="flex items-center gap-2">
            <span className="text-ui-body text-muted">{user.timeZone}</span>
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
