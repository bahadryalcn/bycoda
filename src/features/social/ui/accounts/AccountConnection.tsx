import { InlineError } from "../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { Heading } from "../../../../shared/ui/Heading";

import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { CapabilityList } from "../common/CapabilityList";
import { operationText } from "../common/capabilityText";
import type { Capability, SocialAccount, SocialOperation } from "../../model/social";
import { TOKEN_PLATFORMS } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { TelegramChannelConnect } from "./platform/TelegramChannelConnect";
import { XProfileEditor } from "./platform/XProfileEditor";
import { useAccountWrite } from "./useAccountWrite";
import { ChromeSessionConnect } from "./ChromeSessionConnect";
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

type BrowserState = { status: string; error?: string; source?: "existing-chrome" | "dedicated" };
type OAuthState = { status: string; candidates: { id: string; name: string }[]; error?: string };

function browserStatusText(status: string): string {
  switch (status) {
    case "connected":
      return t("Connected");
    case "waiting":
      return t("Waiting for you");
    case "checking":
      return t("Checking…");
    case "idle":
      return t("Not checked");
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
  const [operations, setOperations] = useState<SocialOperation[]>(["publish"]);
  const operationOptions = capabilities.length
    ? capabilities.filter((item) => item.status !== "unsupported").map((item) => item.operation)
    : ["publish" as const];
  const requestedOperations = operations.filter((operation) =>
    operationOptions.includes(operation),
  );
  const { error, is, write } = useAccountWrite(
    t("The connection could not be started. Try again."),
  );
  const usesBrowser = account.connection === "browser";
  const isTelegram = account.platform === "telegram";
  const isToken = TOKEN_PLATFORMS.includes(account.platform) && !usesBrowser;
  const isOrganization = account.accountType === "organization";
  const needsPageTarget = account.platform === "linkedin" && isOrganization && !account.platformId;
  const locked = disabled || is("connect:browser") || is("connect:oauth");

  const startBrowser = () =>
    write("connect:browser", async () => {
      const result = await client.browserBegin(account.id, resourceId || undefined);
      setBrowser(result);
      if (result.status === "connected") onChanged();
    });
  const checkBrowser = () =>
    write("check:browser", async () => {
      const result = await client.browserStatus(account.id);
      setBrowser(result);
      if (result.status === "connected") onChanged();
    });
  const cancelBrowser = () =>
    write("cancel:browser", async () => {
      setBrowser(await client.browserCancelLogin(account.id));
    });
  const startOAuth = () =>
    write("connect:oauth", async () => {
      if (!requestedOperations.length || (isOrganization && !/^\d+$/.test(resourceId))) return;
      const begin = await client.oauthBegin(
        account.id,
        isOrganization ? resourceId : undefined,
        requestedOperations,
      );
      setOAuth({ status: "waiting", candidates: [] });
      await openExternal(begin.url);
    });
  const checkOAuth = () =>
    write("check:oauth", async () => {
      const result = await client.oauthStatus(account.id);
      setOAuth(result);
      if (result.status === "connected") onChanged();
    });
  const chooseCandidate = (candidateId: string) =>
    write(`candidate:${candidateId}`, () => client.oauthSelect(account.id, candidateId)).then(
      (result) => result !== undefined && onChanged(),
    );
  const connectToken = () =>
    write("connect:token", () => client.tokenConnect(account.id)).then(
      (result) => result !== undefined && onChanged(),
    );

  const connectLabel = account.connected ? t("Reconnect") : t("Connect");

  return (
    <section
      {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
      aria-label={t("Connection")}
    >
      <Heading size="item">{t("Connection")}</Heading>
      <Text as="p" tone="muted" leading="snug" className="social-muted">
        {!account.connected
          ? t("Connection needed")
          : onThisComputer
            ? t("This account is connected on the selected computer.")
            : t("This account is connected on another computer.")}
      </Text>
      <CapabilityList capabilities={capabilities} grouped />
      {usesBrowser ? (
        <div className="social-field-row">
          {account.platform === "linkedin" && isOrganization ? (
            <TextField
              label={t("LinkedIn Page ID or URL")}
              value={resourceId}
              disabled={locked}
              onChange={(event) => setResourceId(event.currentTarget.value)}
            />
          ) : null}
          <Button
            variant="primary"
            size="sm"
            loading={is("connect:browser")}
            disabled={locked || (needsPageTarget && !resourceId.trim())}
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
          {browser?.status === "waiting" ? (
            <Text as="p" tone="muted">
              {t(
                "Close the dedicated sign-in window after signing in so the connection can be verified.",
              )}
            </Text>
          ) : null}
          {browser?.status === "waiting" || browser?.status === "checking" ? (
            <Button
              variant="ghost"
              size="sm"
              loading={is("cancel:browser")}
              disabled={disabled}
              onClick={() => void cancelBrowser().catch(() => undefined)}
            >
              {t("Cancel sign-in")}
            </Button>
          ) : null}
          {browser?.source === "existing-chrome" ? (
            <Text as="p" tone="muted">
              {t("Uses your existing Chrome session.")}
            </Text>
          ) : null}
          {browser ? (
            <Text as="span" tone="muted" leading="snug" className="social-muted">
              {browserStatusText(browser.status)}
            </Text>
          ) : null}
        </div>
      ) : null}
      {usesBrowser ? (
        <ChromeSessionConnect
          client={client}
          accountId={account.id}
          resourceId={resourceId || undefined}
          disabled={locked || !onThisComputer || (needsPageTarget && !resourceId.trim())}
          onChanged={onChanged}
        />
      ) : null}
      {!usesBrowser && !isToken && !isTelegram ? (
        <>
          <Disclosure summary={t("Permissions")} variant="row" size="sm">
            <FieldGroup legend={t("What this account can do")} hideLegend layout="row">
              {operationOptions.map((operation) => (
                <Checkbox
                  key={operation}
                  label={operationText(operation)}
                  checked={operations.includes(operation)}
                  disabled={locked}
                  onChange={(event) =>
                    setOperations((current) =>
                      event.target.checked
                        ? [...current, operation]
                        : current.filter((item) => item !== operation),
                    )
                  }
                />
              ))}
            </FieldGroup>
          </Disclosure>
          {!requestedOperations.length ? (
            <Text as="p" size="caption" tone="secondary">
              {t("Choose at least one permission.")}
            </Text>
          ) : null}
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
              disabled={
                locked ||
                !requestedOperations.length ||
                (isOrganization && !/^\d+$/.test(resourceId))
              }
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
            {oauth ? (
              <Text as="span" size="caption" tone="secondary">
                {browserStatusText(oauth.status)}
              </Text>
            ) : null}
          </div>
        </>
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
        <InlineError>{browser?.error ?? oauth?.error}</InlineError>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </section>
  );
}
