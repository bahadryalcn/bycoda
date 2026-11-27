import { InlineError } from "../../../../shared/ui/InlineError";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Switch } from "../../../../shared/ui/Switch";

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
  const { failureTitle, details, is, write } = useAccountWrite(
    t("The inbox setting could not be saved. Try again."),
  );
  const [seen, setSeen] = useState(enabled);
  if (seen !== enabled) {
    setSeen(enabled);
    setValue(enabled);
  }

  return (
    <div className="social-card">
      <Switch
        label={t("Refresh the inbox automatically")}
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
      {failureTitle ? (
        <InlineError details={details} live="assertive" icon={null}>
          {failureTitle}
        </InlineError>
      ) : null}
    </div>
  );
}
