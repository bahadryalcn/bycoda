import { useT } from "../../../shared/i18n";
import type { LiveStreamLiveAccount } from "../../../shared/model/host-contracts/live-stream";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Text } from "../../../shared/ui/Text";
import { CONFIGURED_OBS, groupAccounts, platformNames } from "../model/liveDestinations";

/** Choose several Social accounts, grouped by canvas, or the OBS server configured by hand. */
export function LiveDestinationPicker({
  accounts,
  selected,
  disabled,
  onToggle,
}: {
  accounts: readonly LiveStreamLiveAccount[];
  selected: readonly string[];
  disabled: boolean;
  onToggle: (key: string) => void;
}) {
  const t = useT();
  const groups = groupAccounts(accounts);
  const rows = (list: LiveStreamLiveAccount[]) =>
    list.map((entry) => (
      <Checkbox
        key={entry.accountId}
        size="body"
        label={t("{p0} · {p1}", { p0: platformNames[entry.platform], p1: entry.label })}
        checked={selected.includes(entry.accountId)}
        disabled={disabled}
        onChange={() => onToggle(entry.accountId)}
      />
    ));
  return (
    <FieldGroup legend={t("Stream to")} disabled={disabled}>
      {groups.horizontal.length > 0 ? (
        <FieldGroup
          legend={t("Horizontal")}
          description={t("Sent from the main OBS canvas.")}
          descriptionVisible
          gap="sm"
        >
          {rows(groups.horizontal)}
        </FieldGroup>
      ) : null}
      {groups.vertical.length > 0 ? (
        <FieldGroup
          legend={t("Vertical")}
          description={t("Sent from the Aitum Vertical canvas.")}
          descriptionVisible
          gap="sm"
        >
          {rows(groups.vertical)}
        </FieldGroup>
      ) : null}
      <FieldGroup legend={t("Manual")} gap="sm">
        <Checkbox
          size="body"
          label={t("Configured OBS server")}
          checked={selected.includes(CONFIGURED_OBS)}
          disabled={disabled}
          onChange={() => onToggle(CONFIGURED_OBS)}
        />
        <Text size="caption" tone="secondary">
          {t("Uses the server and key already set in OBS. Cannot be combined with accounts.")}
        </Text>
      </FieldGroup>
    </FieldGroup>
  );
}
