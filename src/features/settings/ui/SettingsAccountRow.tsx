import { AccountRailRow } from "../../account";
import { t, useLocale } from "../../../shared/i18n";
import type { SettingsSectionId } from "../model/settings";

/** Account is not a list group: it is the avatar row leading the category list. */
export function navigationGroups<T extends { id: string }>(groups: T[]): T[] {
  return groups.filter((group) => group.id !== "account");
}

/** Id of the account row; names the shared panel while the Account section is open. */
export const accountRowId = (panelId: string) => `${panelId}-account`;

/**
 * Avatar and name (or "Sign in") as the first group of the in-dialog navigation, so the
 * account is reachable without scrolling and never overlaps the category list.
 */
export function SettingsAccountRow({
  section,
  panelId,
  onSelect,
}: {
  section: SettingsSectionId;
  panelId: string;
  onSelect: (section: SettingsSectionId) => void;
}) {
  useLocale();
  return (
    <div className="bycoda-settings-category-group bycoda-settings-account-row" role="presentation">
      <span className="bycoda-settings-category-label" aria-hidden="true">
        {t("My account")}
      </span>
      <AccountRailRow
        id={accountRowId(panelId)}
        active={section === "account"}
        onSelect={() => onSelect("account")}
      />
    </div>
  );
}
