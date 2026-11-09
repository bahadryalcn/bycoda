import { useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Group, Row } from "../../../settings/public/settingsControls";
import { Switch } from "../../../../shared/ui/Switch";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type InboxSettingsProps = {
  client: SocialClient;
  /** Auto-refresh as the Host reports it (snapshot.pollingEnabled). */
  enabled: boolean;
  onChanged(): void;
};

/** One switch: whether the inbox checks connected accounts by itself. */
export function InboxSettings({ client, enabled, onChanged }: InboxSettingsProps) {
  const [value, setValue] = useState(enabled);
  const { error, is, write } = useAccountWrite(
    t("The inbox setting could not be saved. Try again."),
  );
  useEffect(() => {
    setValue(enabled);
  }, [enabled]);

  return (
    <Group
      title={t("Inbox")}
      feedback={
        error ? (
          <InlineMessage tone="danger" live="assertive" icon={null}>
            {error}
          </InlineMessage>
        ) : null
      }
    >
      <Row
        label={t("Refresh the inbox automatically")}
        description={t(
          "Checks connected accounts for new messages and comments while the Host is running.",
        )}
      >
        <Switch
          aria-label={t("Refresh the inbox automatically")}
          checked={value}
          disabled={is("inbox.settings")}
          onCheckedChange={(next) => {
            setValue(next);
            void write("inbox.settings", () => client.inbox.settings({ autoRefresh: next }))
              .then((result) => {
                if (result === undefined) setValue(enabled);
                else onChanged();
              })
              .catch(() => undefined);
          }}
        />
      </Row>
    </Group>
  );
}
