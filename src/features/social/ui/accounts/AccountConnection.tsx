import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { Heading } from "../../../../shared/ui/Heading";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { CapabilityList } from "../common/CapabilityList";
import { operationText } from "../common/capabilityText";
import type { Capability, SocialAccount, SocialOperation } from "../../model/social";
import { TOKEN_PLATFORMS } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { usePollingRefresh } from "../../hooks/usePollingRefresh";
import type { HostProject } from "../../../connections/public/protocol";
import { TelegramChannelConnect } from "./platform/TelegramChannelConnect";
import { XProfileEditor } from "./platform/XProfileEditor";
import { InstagramAccountTools } from "./platform/InstagramAccountTools";
import { useAccountWrite } from "./useAccountWrite";
import { ChromeSessionConnect } from "./ChromeSessionConnect";
import "./accounts.css";

export type AccountConnectionProps = {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  projects?: readonly HostProject[];
  /** This account's executor is the computer the owner is looking at. */
  onThisComputer: boolean;
  disabled: boolean;
  onChanged(): void;
  onBrowserStatusChange?(status: string): void;
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
  projects = [],
  onThisComputer,
  disabled,
  onChanged,
  onBrowserStatusChange,
}: AccountConnectionProps) {
  const [resourceId, setResourceId] = useState(
    account.platform === "linkedin" && account.connection === "oauth"
      ? (/^urn:li:organization:(\d+)$/.exec(account.platformId)?.[1] ?? "")
      : "",
  );
  const [browser, setBrowser] = useState<BrowserState>();
  const [browserPollFailed, setBrowserPollFailed] = useState(false);
  const [oauth, setOAuth] = useState<OAuthState>();
  const [linkedinLiveComments, setLinkedinLiveComments] = useState(false);
  const [operations, setOperations] = useState<SocialOperation[]>(() =>
    account.platform === "linkedin" &&
    account.accountType === "member" &&
    account.scopes.includes("r_member_postAnalytics")
      ? ["publish", "analytics"]
      : ["publish"],
  );
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
  const xBillingDisabled = account.platform === "x" && !account.xApiProduct;
  const isTelegram = account.platform === "telegram";
  const isToken = TOKEN_PLATFORMS.includes(account.platform) && !usesBrowser;
  const isOrganization = account.accountType === "organization";
  const needsPageTarget = account.platform === "linkedin" && isOrganization && !account.platformId;
  const locked = disabled || is("connect:browser") || is("connect:oauth");
  const connectVariant = account.connected ? "secondary" : "primary";
  const browserPending = browser?.status === "waiting" || browser?.status === "checking";

  const updateBrowser = (result: BrowserState) => {
    setBrowserPollFailed(false);
    setBrowser(result);
    onBrowserStatusChange?.(result.status);
    if (result.status === "connected") onChanged();
  };
  const refreshBrowser = usePollingRefresh({
    active: usesBrowser && browserPending && !disabled && !is("cancel:browser"),
    scope: client,
    intervalMs: 2_000,
    load: async (isCurrent) => {
      try {
        const result = await client.browserStatus(account.id, true);
        if (isCurrent()) updateBrowser(result);
      } catch (error) {
        if (isCurrent()) setBrowserPollFailed(true);
        throw error;
      }
    },
  });

  const startBrowser = () =>
    write("connect:browser", async () => {
      updateBrowser(await client.browserBegin(account.id, resourceId || undefined));
    });
  const checkBrowser = () =>
    write("check:browser", async () => {
      if (browserPending) await refreshBrowser();
      else updateBrowser(await client.browserStatus(account.id));
    });
  const cancelBrowser = () =>
    write("cancel:browser", async () => {
      updateBrowser(await client.browserCancelLogin(account.id));
    });
  const startOAuth = () =>
    write("connect:oauth", async () => {
      if (
        xBillingDisabled ||
        !requestedOperations.length ||
        (isOrganization && !/^\d+$/.test(resourceId))
      )
        return;
      const begin = await client.oauthBegin(
        account.id,
        isOrganization ? resourceId : undefined,
        requestedOperations,
        ...(linkedinLiveComments ? [true as const] : []),
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
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "social-card")}
      aria-label={t("Connection")}
    >
      <div className="social-card-head">
        <Heading size="item">{t("Connection")}</Heading>
        {account.connected && browser?.status !== "failed" ? (
          <InfoPopover className="shrink-0">
            {onThisComputer
              ? t("This account is connected on the selected computer.")
              : t("This account is connected on another computer.")}
          </InfoPopover>
        ) : null}
      </div>
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
            variant={connectVariant}
            size="sm"
            loading={is("connect:browser")}
            disabled={
              locked ||
              is("check:browser") ||
              browserPending ||
              (needsPageTarget && !resourceId.trim())
            }
            onClick={() => void startBrowser().catch(() => undefined)}
          >
            {account.connected ? t("Sign in again in the browser") : t("Sign in in the browser")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={is("check:browser")}
            disabled={locked || is("check:browser") || is("cancel:browser")}
            onClick={() => void checkBrowser().catch(() => undefined)}
          >
            {t("Check connection")}
          </Button>
          {browser?.status === "waiting" && browser.source !== "existing-chrome" ? (
            <InlineMessage tone="info" live="off">
              {t(
                "Close the dedicated sign-in window after signing in so the connection can be verified.",
              )}
            </InlineMessage>
          ) : null}
          {browserPending ? (
            <Button
              variant="ghost"
              size="sm"
              loading={is("cancel:browser")}
              disabled={disabled}
              onClick={() => void cancelBrowser().catch(() => undefined)}
            >
              {t("Stop")}
            </Button>
          ) : null}
          {browser && (browser.status !== "failed" || !browser.error) ? (
            <LiveText
              text={browserStatusText(browser.status)}
              tone="muted"
              leading="snug"
              className="social-muted"
            />
          ) : null}
        </div>
      ) : null}
      {usesBrowser ? (
        <ChromeSessionConnect
          client={client}
          accountId={account.id}
          resourceId={resourceId || undefined}
          disabled={
            locked || browserPending || !onThisComputer || (needsPageTarget && !resourceId.trim())
          }
          onChanged={() => {
            setBrowser(undefined);
            onBrowserStatusChange?.("connected");
            onChanged();
          }}
        />
      ) : null}
      {!usesBrowser && !isToken && !isTelegram ? (
        <>
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
              variant={connectVariant}
              size="sm"
              loading={is("connect:oauth")}
              disabled={
                locked ||
                xBillingDisabled ||
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
          <Disclosure summary={t("Permissions")} variant="row" size="sm">
            <FieldGroup legend={t("What this account can do")} hideLegend layout="row">
              {operationOptions.map((operation) => (
                <Checkbox
                  size="secondary"
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
              {account.platform === "linkedin" && isOrganization ? (
                <Checkbox
                  size="secondary"
                  label={t("LinkedIn Live comments")}
                  checked={linkedinLiveComments}
                  disabled={locked}
                  onChange={(event) => setLinkedinLiveComments(event.target.checked)}
                />
              ) : null}
            </FieldGroup>
          </Disclosure>
          {!requestedOperations.length ? (
            <InlineMessage tone="warning" live="off">
              {t("Choose at least one permission.")}
            </InlineMessage>
          ) : null}
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
          variant={connectVariant}
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
      {browser?.error ? (
        <InlineError details={browser.error}>
          {t("Sign-in failed. Start sign-in again.")}
        </InlineError>
      ) : oauth?.error ? (
        <InlineError details={oauth.error}>
          {t("The connection could not be started. Try again.")}
        </InlineError>
      ) : null}
      {browserPollFailed && !disabled ? (
        <InlineError>{t("Could not reach this computer.")}</InlineError>
      ) : null}
      {error ? (
        <InlineError details={error}>
          {t("The connection could not be started. Try again.")}
        </InlineError>
      ) : null}
      <CapabilityList capabilities={capabilities} grouped />
      {account.platform === "x" && account.connected ? (
        <XProfileEditor client={client} accountId={account.id} />
      ) : null}
      {account.platform === "instagram" ? (
        <InstagramAccountTools
          client={client}
          account={account}
          capabilities={capabilities}
          projects={projects}
          disabled={disabled}
        />
      ) : null}
    </section>
  );
}
