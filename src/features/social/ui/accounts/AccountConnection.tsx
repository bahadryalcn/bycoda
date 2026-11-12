import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { CapabilityList } from "../common/CapabilityList";
import type { Capability, SocialAccount } from "../../model/social";
import { TOKEN_PLATFORMS } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { TelegramChannelConnect } from "./platform/TelegramChannelConnect";
import { XProfileEditor } from "./platform/XProfileEditor";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type AccountConnectionProps = {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  /** This account's executor is the computer the owner is looking at. */
  onThisComputer: boolean;
  disabled: boolean;
  onChanged(): void;
};

type BrowserState = { status: string; error?: string };
type OAuthState = { status: string; candidates: { id: string; name: string }[]; error?: string };

function browserStatusText(status: string): string {
  switch (status) {
    case "connected":
      return t("Connected");
    case "waiting":
      return t("Waiting for you");
    case "failed":
      return t("Connection needs a retry");
    default:
      return t("Checking…");
  }
}

/**
 * How one account is connected: the capability list with its Connect action, the flow that fits the
 * account (browser sign-in, OAuth in the browser, a token, or the Telegram channel review) and the
 * X profile editor when it applies.
 */
export function AccountConnection({
  client,
  account,
  capabilities,
  onThisComputer,
  disabled,
  onChanged,
}: AccountConnectionProps) {
  const [resourceId, setResourceId] = useState("");
  const [browser, setBrowser] = useState<BrowserState>();
  const [oauth, setOAuth] = useState<OAuthState>();
  const { error, is, write } = useAccountWrite(
    t("The connection could not be started. Try again."),
  );
  const usesBrowser = account.connection === "browser";
  const isTelegram = account.platform === "telegram";
  const isToken = TOKEN_PLATFORMS.includes(account.platform) && !usesBrowser;
  const isOrganization = account.accountType === "organization";
  const locked = disabled || is("connect:browser") || is("connect:oauth");

  const startBrowser = () =>
    write("connect:browser", async () => {
      setBrowser(await client.browserBegin(account.id, resourceId || undefined));
    });
  const checkBrowser = () =>
    write("check:browser", async () => setBrowser(await client.browserStatus(account.id)));
  const startOAuth = () =>
    write("connect:oauth", async () => {
      const begin = await client.oauthBegin(account.id, isOrganization ? resourceId : undefined, [
        "publish",
      ]);
      setOAuth({ status: "waiting", candidates: [] });
      await openExternal(begin.url);
    });
  const checkOAuth = () =>
    write("check:oauth", async () => setOAuth(await client.oauthStatus(account.id)));
  const chooseCandidate = (candidateId: string) =>
    write(`candidate:${candidateId}`, () => client.oauthSelect(account.id, candidateId)).then(
      (result) => result !== undefined && onChanged(),
    );
  const connectToken = () =>
    write("connect:token", () => client.tokenConnect(account.id)).then(
      (result) => result !== undefined && onChanged(),
    );

  // A capability row's Connect button starts the flow this account uses. Telegram has no one-click
  // flow: its channel review is the connection, so the row offers none.
  const onConnect = isTelegram
    ? undefined
    : () => {
        if (usesBrowser) startBrowser();
        else if (isToken) connectToken();
        else startOAuth();
      };
  const connectLabel = account.connected ? t("Reconnect") : t("Connect");

  return (
    <section
      {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
      aria-label={t("Connection")}
    >
      <Heading size="item">{t("Connection")}</Heading>
      <Text as="p" tone="muted" leading="snug" className="social-muted">
        {onThisComputer
          ? t("This account is connected on the selected computer.")
          : t("This account is connected on another computer.")}
      </Text>
      <CapabilityList capabilities={capabilities} onConnect={disabled ? undefined : onConnect} />
      {usesBrowser ? (
        <div className="social-field-row">
          <Button
            variant="primary"
            size="sm"
            loading={is("connect:browser")}
            disabled={locked}
            onClick={() => void startBrowser().catch(() => undefined)}
          >
            {account.connected ? t("Sign in again in the browser") : t("Sign in in the browser")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={is("check:browser")}
            disabled={disabled || is("check:browser")}
            onClick={() => void checkBrowser().catch(() => undefined)}
          >
            {t("Check connection")}
          </Button>
          {browser ? (
            <Text as="span" tone="muted" leading="snug" className="social-muted">
              {browserStatusText(browser.status)}
            </Text>
          ) : null}
        </div>
      ) : null}
      {!usesBrowser && !isToken && !isTelegram ? (
        <div className="social-field-row">
          {isOrganization ? (
            <TextField
              label={t("Organization ID")}
              numeric
              value={resourceId}
              disabled={locked}
              onChange={(event) => setResourceId(event.currentTarget.value)}
            />
          ) : null}
          <Button
            variant="primary"
            size="sm"
            loading={is("connect:oauth")}
            disabled={locked || (isOrganization && !/^\d+$/.test(resourceId))}
            onClick={() => void startOAuth().catch(() => undefined)}
          >
            {account.connected ? t("Reconnect in browser") : t("Connect in browser")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={is("check:oauth")}
            disabled={disabled || is("check:oauth")}
            onClick={() => void checkOAuth().catch(() => undefined)}
          >
            {t("Check connection")}
          </Button>
        </div>
      ) : null}
      {oauth?.candidates.length ? (
        <div
          className="social-tag-line"
          role="group"
          aria-label={t("Choose the account to connect")}
        >
          {oauth.candidates.map((candidate) => (
            <Button
              key={candidate.id}
              variant="secondary"
              size="sm"
              loading={is(`candidate:${candidate.id}`)}
              disabled={disabled}
              onClick={() => void chooseCandidate(candidate.id).catch(() => undefined)}
            >
              {candidate.name}
            </Button>
          ))}
        </div>
      ) : null}
      {isToken && !isTelegram ? (
        <Button
          variant="primary"
          size="sm"
          loading={is("connect:token")}
          disabled={locked}
          onClick={() => void connectToken().catch(() => undefined)}
        >
          {connectLabel}
        </Button>
      ) : null}
      {isTelegram ? (
        <TelegramChannelConnect
          account={account}
          client={client}
          disabled={disabled}
          onRefresh={onChanged}
        />
      ) : null}
      {account.platform === "x" && account.connected ? (
        <XProfileEditor client={client} accountId={account.id} accountName={account.name} />
      ) : null}
      {browser?.error || oauth?.error ? (
        <InlineMessage tone="danger">{browser?.error ?? oauth?.error}</InlineMessage>
      ) : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
    </section>
  );
}
