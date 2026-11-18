import { useState, type FormEvent } from "react";
import {
  LINKEDIN_LIVE_ACCESS,
  LINKEDIN_LIVE_CONFIRM,
  LINKEDIN_LIVE_STUDIO,
  type LinkedInLiveStatus,
} from "../../../../integrations/social/live-linkedin";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { PasswordField } from "../../../../shared/ui/PasswordField";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";
import { LinkedInLiveComments } from "./LinkedInLiveComments";

type Props = {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
};

export function LinkedInLive({ account, client, disabled }: Props) {
  return (
    <LinkedInLiveAccount
      key={JSON.stringify([account.id, account.platformId, account.connected, account.connection])}
      account={account}
      client={client}
      disabled={disabled}
    />
  );
}

function LinkedInLiveAccount({ account, client, disabled }: Props) {
  const [status, setStatus] = useState<LinkedInLiveStatus>();
  const { error, is, write } = useAccountWrite(t("Could not update LinkedIn Live."));
  const accountId = account.id;
  const connectionRequired = !account.connected || status?.state === "reconnect";
  const pending = is("status") || is("save") || is("clear");
  const refreshStatus = () =>
    write("status", async () => {
      setStatus(await client.request<LinkedInLiveStatus>("linkedin.live.status", { accountId }));
    });
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || pending || connectionRequired) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    void write("save", async () => {
      const next = await client
        .request<LinkedInLiveStatus>("linkedin.live.credentials.save", {
          accountId,
          eventId: data.get("eventId"),
          streamUrl: data.get("streamUrl"),
          streamKey: data.get("streamKey"),
          confirm: LINKEDIN_LIVE_CONFIRM,
        })
        .catch(() => {
          throw new Error(t("Could not save LinkedIn Live credentials."));
        });
      form.reset();
      setStatus(next);
    }).catch(() => undefined);
  };
  const clear = () =>
    write("clear", async () => {
      await client.request("linkedin.live.credentials.clear", { accountId });
      setStatus({ state: "missing", studioUrl: LINKEDIN_LIVE_STUDIO });
    });
  const open = (url: string) => void write("open", () => openExternal(url)).catch(() => undefined);

  return (
    <Disclosure summary={t("LinkedIn Live")} variant="row">
      <FieldGroup variant="bare" layout="row">
        <Button
          variant="secondary"
          size="sm"
          loading={is("open")}
          onClick={() => open(LINKEDIN_LIVE_STUDIO)}
        >
          {t("Open Live Studio")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={is("open")}
          onClick={() => open(LINKEDIN_LIVE_ACCESS)}
        >
          {t("Check Live eligibility")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          loading={is("status")}
          onClick={() => void refreshStatus().catch(() => undefined)}
        >
          {t("Refresh status")}
        </Button>
      </FieldGroup>
      {connectionRequired ? (
        <Text as="p">{t("Reconnect LinkedIn to save a Live destination.")}</Text>
      ) : status?.state === "stored" ? (
        <Text as="p">{t("Credentials stored for event {p0}.", { p0: status.eventId })}</Text>
      ) : status?.state === "missing" ? (
        <Text as="p">{t("No LinkedIn Live credentials stored.")}</Text>
      ) : null}
      <form onSubmit={save}>
        <FieldGroup variant="bare" disabled={disabled || pending || connectionRequired}>
          <TextField
            label={t("LinkedIn event ID")}
            name="eventId"
            inputMode="numeric"
            pattern="[1-9][0-9]{0,24}"
            maxLength={25}
            required
          />
          <PasswordField
            label={t("Stream URL")}
            name="streamUrl"
            autoComplete="off"
            maxLength={4096}
            required
          />
          <PasswordField
            label={t("Stream key")}
            name="streamKey"
            autoComplete="off"
            maxLength={4096}
            required
          />
          <Button type="submit" variant="primary" size="sm" loading={is("save")}>
            {t("Save Live credentials")}
          </Button>
        </FieldGroup>
      </form>
      {status?.state === "stored" || connectionRequired ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          loading={is("clear")}
          onClick={() => void clear().catch(() => undefined)}
        >
          {t("Clear Live credentials")}
        </Button>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {account.accountType === "organization" && account.connection === "oauth" ? (
        <LinkedInLiveComments
          accountId={accountId}
          client={client}
          disabled={disabled}
          canReply={account.scopes.includes("w_organization_social_feed")}
        />
      ) : null}
    </Disclosure>
  );
}
