import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { PasswordField } from "../../../../shared/ui/PasswordField";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { Row } from "../settingsControls";
import { accountChannelIds, discordSaveInput, parseChannelIds } from "./chatAccountInputs";
import {
  AccountFormActions,
  MessagingAccountsCard,
  useAccountSave,
  type AccountFormProps,
} from "./MessagingAccountsCard";
import { SetupSteps } from "./SetupSteps";

export function DiscordSettings() {
  useLocale();
  return (
    <MessagingAccountsCard
      provider="discord"
      emptyLabel={t("No Discord bots connected yet.")}
      addLabel={t("Add bot")}
      describe={(account) => {
        const count = accountChannelIds(account).length;
        return count === 1 ? t("1 channel") : t("{p0} channels", { p0: count });
      }}
      Form={DiscordAccountForm}
    />
  );
}

function DiscordAccountForm({ account, onSaved, onCancel }: AccountFormProps) {
  useLocale();
  const [initialChannels] = useState(() => accountChannelIds(account).join("\n"));
  const [token, setToken] = useState("");
  const [channels, setChannels] = useState(initialChannels);
  const { saving, error, save } = useAccountSave(onSaved);
  const dirty = token !== "" || channels !== initialChannels;
  const submit = () => {
    save(discordSaveInput(token, channels, account?.id)).catch(() => undefined);
  };
  return (
    <>
      <Row
        stacked
        label={account ? t("Edit Discord bot") : t("Connect a bot")}
        info={t(
          "Discord connects with a bot token only, because Discord does not let apps read your own messages.",
        )}
        persistence={{ mode: "explicit", state: saving ? "saving" : dirty ? "dirty" : "idle" }}
      >
        <div className="integration-fields" data-layout="single">
          <PasswordField
            label={t("Discord bot token")}
            aria-label={t("Discord bot token")}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={account ? t("Leave empty to keep the saved token") : undefined}
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
          />
          <TextareaField
            label={t("Channel IDs")}
            aria-label={t("Channel IDs")}
            description={t("Separate IDs with commas or new lines.")}
            value={channels}
            onChange={(event) => setChannels(event.target.value)}
            rows={3}
            spellCheck={false}
            disabled={saving}
          />
        </div>
      </Row>
      <SetupSteps
        title={t("How to set up a Discord bot")}
        label={t("Discord bot setup")}
        steps={[
          t("Create an application at discord.com/developers/applications and add a bot."),
          t("Reset the bot token, copy it and paste it above."),
          t("Under Bot, enable the Message Content intent."),
          t(
            "Invite the bot to your server with the Read Messages, Read Message History and Send Messages permissions.",
          ),
          t(
            "Turn on Developer Mode in Discord settings, then right-click each channel and choose Copy Channel ID.",
          ),
        ]}
      />
      <AccountFormActions
        saving={saving}
        error={error}
        disabled={parseChannelIds(channels).length === 0 || (!account && !token.trim())}
        onSave={submit}
        onCancel={onCancel}
      />
    </>
  );
}
