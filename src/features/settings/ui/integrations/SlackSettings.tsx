import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { copyText } from "../../../../platform/tauri/clipboard";
import { Button } from "../../../../shared/ui/Button";
import { PasswordField } from "../../../../shared/ui/PasswordField";
import { TextField } from "../../../../shared/ui/TextField";
import { Copy } from "../../../../shared/ui/icons";
import { AdvancedSettings, Row, Toggle } from "../settingsControls";
import { BrowserSignIn } from "./BrowserSignIn";
import { slackSaveInput, slackSignInSaveInput } from "./chatAccountInputs";
import {
  AccountFormActions,
  MessagingAccountsCard,
  useAccountSave,
  type AccountFormProps,
} from "./MessagingAccountsCard";
import { SetupSteps } from "./SetupSteps";

/**
 * Scopes the Slack provider reads channels, DMs and users with, and replies through. Browser
 * sign-in requests the same names as user token scopes.
 */
export const SLACK_BOT_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "im:read",
  "im:history",
  "mpim:read",
  "mpim:history",
  "users:read",
  "chat:write",
] as const;

/** Loopback redirect Slack apps must register; native listens on this fixed port. */
export const SLACK_REDIRECT_URL = "https://bycoda.codes/oauth/slack/";

export function SlackSettings() {
  useLocale();
  return (
    <MessagingAccountsCard
      provider="slack"
      emptyLabel={t("No Slack workspaces connected yet.")}
      addLabel={t("Add workspace")}
      describe={(account) => account.identity || t("Slack workspace")}
      Form={SlackAccountForm}
    />
  );
}

function SlackAccountForm({ account, onSaved, onCancel }: AccountFormProps) {
  useLocale();
  const [useBotToken, setUseBotToken] = useState(false);
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [authHandle, setAuthHandle] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { saving, error, save } = useAccountSave(onSaved);
  const submitToken = () => {
    save(slackSaveInput(token, account?.id)).catch(() => undefined);
  };
  const submitSignIn = (handle = authHandle) => {
    if (handle) save(slackSignInSaveInput(handle, account?.id)).catch(() => undefined);
  };
  const dirty = useBotToken ? token !== "" : authHandle !== null;
  return (
    <>
      <Row
        stacked
        label={account ? t("Reconnect workspace") : t("Connect a workspace")}
        info={
          useBotToken
            ? undefined
            : t(
                "Sign in with the Slack account whose channels and direct messages you want to read and answer.",
              )
        }
        persistence={{ mode: "explicit", state: saving ? "saving" : dirty ? "dirty" : "idle" }}
      >
        {useBotToken ? (
          <div className="integration-fields">
            <PasswordField
              label={t("Slack bot token")}
              aria-label={t("Slack bot token")}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitToken();
              }}
              placeholder="xoxb-…"
              autoComplete="off"
              spellCheck={false}
              disabled={saving}
            />
          </div>
        ) : (
          <BrowserSignIn
            purpose="slack"
            clientId={clientId}
            signedIn={authHandle !== null}
            disabled={saving}
            onSignedIn={(handle) => {
              setAuthHandle(handle);
              submitSignIn(handle);
            }}
          />
        )}
      </Row>
      {useBotToken ? (
        <SetupSteps
          title={t("How to get a bot token")}
          label={t("Slack app setup")}
          steps={[
            t("Create a Slack app at api.slack.com/apps for your workspace."),
            t("Under OAuth & Permissions, add the bot token scopes listed below."),
            t("Install the app to your workspace and copy the Bot User OAuth Token (xoxb-…)."),
            t("Invite the bot to each channel it should read with /invite."),
          ]}
        >
          <p className="integration-code">{SLACK_BOT_SCOPES.join(" ")}</p>
          <div className="integration-actions">
            <Button
              stableWidth
              reserveLabels={[t("Copied")]}
              startIcon={<Copy className="icon-sm" />}
              onClick={() => {
                copyText(SLACK_BOT_SCOPES.join(",")).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? t("Copied") : t("Copy scopes")}
            </Button>
          </div>
        </SetupSteps>
      ) : null}
      <AdvancedSettings defaultOpen={false} keepMounted>
        <Row
          label={t("Use a bot token instead")}
          info={t("A bot reads only the channels it is invited to and replies as the bot.")}
        >
          <Toggle
            label={t("Use a bot token instead")}
            on={useBotToken}
            onChange={setUseBotToken}
            disabled={saving}
          />
        </Row>
        {useBotToken ? null : (
          <Row
            stacked
            label={t("Slack app client ID")}
            info={t(
              "Only needed when you use your own Slack app. Turn on PKCE for the app, add the redirect URL {p0} and add these user token scopes: {p1}",
              { p0: SLACK_REDIRECT_URL, p1: SLACK_BOT_SCOPES.join(", ") },
            )}
          >
            <TextField
              label={t("Slack app client ID")}
              hideLabel
              aria-label={t("Slack app client ID")}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="0000000000.0000000000000"
              autoComplete="off"
              spellCheck={false}
              monospace
              disabled={saving}
            />
          </Row>
        )}
      </AdvancedSettings>
      <AccountFormActions
        saving={saving}
        error={error}
        disabled={useBotToken ? !token.trim() : authHandle === null}
        onSave={() => (useBotToken ? submitToken() : submitSignIn())}
        onCancel={onCancel}
      />
    </>
  );
}
