import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext, SocialPanelActiveContext } from "./socialContext";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { NativeSelect } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Link } from "../../../shared/ui/icons";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { socialQueryScope } from "../model/socialQuery";
import { accountConnectionStatus } from "../model/accountConnection";
import type { SocialClient } from "../model/socialClient";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_API_ACCOUNT_TYPES,
  SOCIAL_BROWSER_ACCOUNT_TYPES,
  PROFILE_ONLY_PLATFORMS,
  TOKEN_PLATFORMS,
  type SocialAccount,
  type SocialSnapshot,
  type SocialOperation,
} from "../model/social";
import {
  Empty,
  Notice,
  StatusBadge,
  Composer,
  closeComposer,
  Projects,
  field,
  names,
  operations,
  statuses,
  type Run,
  type Props,
} from "./socialShared";
import { useSocialPending } from "./useSocialPending";
import { SocialBrowserWorkspace, socialBrowserWorkspaceKey } from "./SocialBrowserWorkspace";
import { TelegramChannelConnection, telegramConnectionKey } from "./TelegramChannelConnection";

function accountTypeLabel(id: string) {
  return (
    {
      member: t("Member"),
      professional: t("Professional"),
      page: t("Page"),
      channel: t("Channel"),
      organization: t("Organization account"),
      public_profile: t("Public profile"),
      business: t("Business"),
      bot: t("Bot"),
    } as Record<string, string>
  )[id];
}
function permissionLabels(): Record<string, string> {
  return {
    read: t("Read"),
    draft: t("Draft"),
    publish: t("Sharing"),
    reply: t("Reply"),
    message: t("Message"),
    comment: t("Comment"),
  };
}
/** Sentinel stored in browser availability state; the visible text is translated when rendered. */
const HOST_BROWSER_UNSUPPORTED = "host-browser-unsupported";
function Collapsible({
  collapsed,
  summary,
  children,
}: {
  collapsed: boolean;
  summary: string;
  children: ReactNode;
}) {
  return collapsed ? (
    <details className="social-form">
      <summary>{summary}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}

function AccountCapabilities({ capabilities }: { capabilities: SocialSnapshot["capabilities"][string] }) {
  const common = new Set(["publish", "reply", "inbox.read", "message.start"]);
  const rows = (items: typeof capabilities) => <ul className="flex min-w-0 flex-col divide-y divide-(--ui-tone-neutral-border)">{items.map((cap) => (
    <li key={cap.operation} className="flex min-w-0 flex-col gap-1 py-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="text-ui-caption font-medium">{operations[cap.operation]}</span><StatusBadge status={cap.status} /></div>
      <p className="wrap-anywhere text-ui-caption text-(--ui-text-secondary)">{cap.reason}</p>
      {cap.source ? <a className="text-ui-caption underline" href={cap.source} target="_blank" rel="noreferrer">{t("Official documentation")}</a> : null}
    </li>
  ))}</ul>;
  const extra = capabilities.filter((cap) => !common.has(cap.operation));
  return <>
    {rows(capabilities.filter((cap) => common.has(cap.operation)))}
    {extra.length ? <details><summary className="cursor-pointer text-ui-caption">{t("Other operations")} · {extra.length}</summary>{rows(extra)}</details> : null}
    {!capabilities.length ? <p className="text-ui-caption text-(--ui-text-secondary)">{t("Operation availability has not been loaded.")}</p> : null}
  </>;
}

/**
 * Identity, real connection state, what the account can do and the next step in one block.
 * Capability reasons and documentation stay in the platform details below.
 */
function AccountSummary({
  account,
  capabilities,
  onThisComputer,
  children,
}: {
  account: SocialAccount;
  capabilities: SocialSnapshot["capabilities"][string];
  onThisComputer: boolean;
  children?: ReactNode;
}) {
  const common = ["publish", "reply", "inbox.read", "message.start"];
  const shown = account.connected
    ? common.flatMap((operation) => capabilities.filter((item) => item.operation === operation))
    : [];
  const hasAccess = Object.values(account.grants).some((grants) => grants.length > 0);
  const next = account.paused
    ? t("Resume the account to allow sending.")
    : !account.connected
      ? t("Connect the account in the Connection section.")
      : !onThisComputer
        ? t("This account is connected on another computer.")
        : !hasAccess
          ? t("Give a project access under Project access.")
          : t("Ready to prepare content.");
  return (
    <section className="social-account-summary" aria-label={t("Account summary")}>
      <div className="social-account-summary-head">
        <h2>{account.name}</h2>
        <StatusBadge
          status={account.paused ? "paused" : account.connected ? "connected" : "disconnected"}
        />
        <span className="social-muted">
          {names[account.platform]} ·{" "}
          {account.connection === "browser" ? t("Browser connection") : t("Official API")}
        </span>
      </div>
      {shown.length ? (
        <ul className="social-account-abilities" aria-label={t("What this account can do")}>
          {shown.map((item) => (
            <li key={item.operation}>
              <StatusBadge
                status={item.status}
                label={`${operations[item.operation] ?? item.operation} · ${statuses[item.status] ?? item.status}`}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="social-account-next">{next}</p>
      {children}
    </section>
  );
}

type OAuth = Awaited<ReturnType<SocialClient["oauthStatus"]>>;
type Browser = Awaited<ReturnType<SocialClient["browserStatus"]>>;
type Availability = Record<string, { configured: boolean; reason: string }>;
/** A local operation outcome belongs to the host client and account it ran for. */
type LocalOutcome = {
  client: SocialClient;
  selected: string;
  success: boolean;
  refreshFailed?: boolean;
  text: string;
};

/** Account list, selection and the identity-scoped state shared by its panels. */
export function Accounts({
  client,
  snapshot,
  projects,
  initialProject,
  run: runWorkspace,
  onPrepare,
  onOpenHistory,
}: Props & { onPrepare?: (accountId: string) => void; onOpenHistory?: (accountId?: string) => void }) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [grantProject, setGrantProject] = useState(initialProject ?? projects[0]?.id ?? "");
  const [selected, setSelected] = useState(() => snapshot.accounts[0]?.id ?? "");
  const [localOutcome, setLocalOutcome] = useState<LocalOutcome | null>(null);
  const localIdentity = useRef({ client, selected });
  useLayoutEffect(() => {
    localIdentity.current = { client, selected };
  }, [client, selected]);
  const run: Run = useCallback(async (work, message) => {
    const identity = localIdentity.current;
    let failure = "";
    let completed = false;
    const success = await runWorkspace(async () => {
      try { await work(); completed = true; }
      catch (cause) { failure = cause instanceof Error ? cause.message : String(cause); throw cause; }
    }, message);
    if (localIdentity.current.client === identity.client && localIdentity.current.selected === identity.selected)
      setLocalOutcome({ client: identity.client, selected: identity.selected, success: success || completed, refreshFailed: completed && !success, text: completed && !success ? t("Account operation completed. Its latest status could not be refreshed.") : success ? message ?? t("Account operation completed. Review the current connection status.") : failure || t("Account operation failed. Your entries are preserved.") });
    return success || completed;
  }, [runWorkspace]);
  const outcome =
    localOutcome && localOutcome.client === client && localOutcome.selected === selected
      ? localOutcome
      : null;
  const [availabilityError, setAvailabilityError] = useState("");
  const [availability, setAvailability] = useState<Availability>({});
  useEffect(() => {
    let alive = true;
    void client
      .oauthAvailability()
      .then((value) => {
        if (alive) {
          setAvailability(value);
          setAvailabilityError("");
        }
      })
      .catch(() => {
        if (alive)
          setAvailabilityError(t("Connection settings could not be read. Try again with Refresh."));
      });
    return () => {
      alive = false;
    };
  }, [client.oauthAvailability, snapshot.accounts]);
  const account = snapshot.accounts.find((item) => item.id === selected);
  const queryClient = useQueryClient();
  const scope = socialQueryScope(client);
  // The detail panel owns the status polling; the list only reads the cached status of the selection.
  const selectedOAuth = useQuery<OAuth | null>({
    queryKey: [...scope, "oauth", selected],
    enabled: false,
  });
  const clearStatus = (withBrowser: boolean) => {
    queryClient.setQueryData([...scope, "oauth", selected], null);
    if (withBrowser) queryClient.setQueryData([...scope, "browser", selected], null);
  };
  return (
    <div className="social-page social-accounts-page">
      <div className="social-section-heading">
        <h2>{t("Accounts")}</h2>
        <span className="social-muted">
          {snapshot.accounts.length === 1
            ? t("1 account")
            : t("{p0} accounts", { p0: snapshot.accounts.length })}
        </span>
      </div>
      <AddAccountForm
        client={client}
        projects={projects}
        initialProject={initialProject}
        run={run}
        onCreated={(id) => {
          setSelected(id);
          clearStatus(false);
        }}
      />
      <div
        className="social-columns social-account-workspace"
        data-single={snapshot.accounts.length <= 1}
      >
        <section hidden={snapshot.accounts.length <= 1}>
          <h2>{t("Connected accounts")}</h2>
          {!snapshot.accounts.length ? (
            <Empty title={t("Add your first account")} icon={Link}>
              {t("Start with Add account, then complete the platform connection.")}
            </Empty>
          ) : null}
          <div className="social-list">
            {snapshot.accounts.map((item) => (
              <Button
                disabled={socialLocked}
                type="button"
                variant="item"
                layout="stacked"
                className="social-row"
                aria-pressed={selected === item.id}
                key={item.id}
                onClick={() => {
                  setLocalOutcome(null);
                  clearStatus(true);
                  setSelected(item.id);
                }}
              >
                <strong>{item.name}</strong>
                <span>
                  {names[item.platform]} ·{" "}
                  {availabilityError
                    ? t("Connection check needed")
                    : accountConnectionStatus(
                        item,
                        availability[item.platform],
                        item.id === selected ? selectedOAuth.data?.status : undefined,
                      )}
                  {item.paused ? ` · ${t("Paused")}` : ""}
                </span>
              </Button>
            ))}
          </div>
        </section>
        <section className="social-account-detail">
          {account ? (
            <AccountDetail
              key={`${scope.join(":")}:${account.id}`}
              client={client}
              snapshot={snapshot}
              projects={projects}
              account={account}
              outcome={outcome}
              availability={availability}
              availabilityError={availabilityError}
              grantProject={grantProject}
              onGrantProjectChange={setGrantProject}
              run={run}
              onPrepare={onPrepare}
              onOpenHistory={onOpenHistory}
            />
          ) : (
            <Empty
              title={
                snapshot.accounts.length ? t("Manage your account") : t("Add your first account")
              }
              icon={Link}
            >
              {snapshot.accounts.length
                ? t("Select an account to see its connection status and project access.")
                : t("Start with Add account, then complete the platform connection.")}
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function AddAccountForm({
  client,
  projects,
  initialProject,
  run,
  onCreated,
}: Pick<Props, "client" | "projects" | "initialProject"> & {
  run: Run;
  onCreated: (accountId: string) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [platform, setPlatform] = useState<SocialAccount["platform"]>("x");
  const [newConnection, setNewConnection] = useState<"browser" | "api">("browser");
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  return (
      <Composer title={t("Add account")}>
        <form
          onSubmit={(event) => {
            const form = event.currentTarget;
            const data = field(event);
            void pendingUi
              .run("accounts.add-account", () =>
                run(async () => {
                  const created = await client.request<SocialAccount>("accounts.create", {
                    platform,
                    name: data.get("name"),
                    accountType: data.get("type"),
                    connection:
                      newConnection === "browser"
                        ? "browser"
                        : TOKEN_PLATFORMS.includes(platform)
                          ? "token"
                          : "oauth",
                    projectIds: selectedProjects,
                  });
                  onCreated(created.id);
                }),
              )
              .then((success) => {
                if (success) {
                  form.reset();
                  closeComposer(form);
                }
              });
          }}
          className="social-form"
        >
          <label>
            {t("Platform")}
            <SearchableSelect
              disabled={socialLocked}
              label={t("Platform")}
              triggerProps={{ "aria-label": t("Platform") }}
              value={platform}
              onChange={(value) => setPlatform(value as SocialAccount["platform"])}
              options={SOCIAL_PLATFORMS.map((id) => ({ value: id, label: names[id] }))}
            />
          </label>
          <fieldset disabled={socialLocked}>
            <legend>{t("Connection method")}</legend>
            <SegmentedControl
              label={t("Connection method")}
              value={newConnection}
              selectionRole="radio"
              onValueChange={(value) => setNewConnection(value === "api" ? "api" : "browser")}
              options={[
                { value: "browser", label: t("Browser connection") },
                { value: "api", label: t("API connection") },
              ]}
            />
          </fieldset>
          <TextField
            disabled={socialLocked}
            label={t("Account name")}
            name="name"
            required
            maxLength={200}
          />
          <label>
            {t("Account type")}
            <NativeSelect disabled={socialLocked} name="type" key={`${platform}:${newConnection}`}>
              {(newConnection === "browser"
                ? SOCIAL_BROWSER_ACCOUNT_TYPES[platform]
                : SOCIAL_API_ACCOUNT_TYPES[platform]
              ).map((id) => (
                <option key={id} value={id}>
                  {accountTypeLabel(id)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Projects
            projects={projects}
            selected={selectedProjects}
            onChange={setSelectedProjects}
          />
          <Button
            loading={pendingUi.is("accounts.add-account")}
            disabled={socialLocked}
            variant="primary"
            type="submit"
          >
            {t("Add account")}
          </Button>
          {!selectedProjects.length ? (
            <small>
              {t("If you select a project, it gets read and draft permission on the account.")}
            </small>
          ) : null}
        </form>
      </Composer>
  );
}

/** One account's connection status, grants and destructive actions; remounted per host and account. */
function AccountDetail({
  client,
  snapshot,
  projects,
  account,
  outcome,
  availability,
  availabilityError,
  grantProject,
  onGrantProjectChange,
  run,
  onPrepare,
  onOpenHistory,
}: {
  client: SocialClient;
  snapshot: SocialSnapshot;
  projects: Props["projects"];
  account: SocialAccount;
  outcome: LocalOutcome | null;
  availability: Availability;
  availabilityError: string;
  grantProject: string;
  onGrantProjectChange: (projectId: string) => void;
  run: Run;
  onPrepare?: (accountId: string) => void;
  onOpenHistory?: (accountId?: string) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  // Expiry is compared with the time this detail opened (render stays pure).
  const [openedAt] = useState(Date.now);
  const [oauthOperations, setOAuthOperations] = useState<SocialOperation[]>(["publish"]);
  const [resourceId, setResourceId] = useState("");
  const [grantPermissions, setGrantPermissions] = useState<string[]>(
    () => account.grants[grantProject] ?? [],
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const [browserRisk, setBrowserRisk] = useState(false);
  const [browserAvailability, setBrowserAvailability] = useState<{
    available: boolean;
    reason: string;
  }>();
  const apiAccountType = (SOCIAL_API_ACCOUNT_TYPES[account.platform] as readonly string[]).includes(
    account.accountType,
  );
  const queryClient = useQueryClient();
  const scope = socialQueryScope(client);
  const active = useContext(SocialPanelActiveContext);
  const visible = useQueryVisible();
  const oauthKey = [...scope, "oauth", account.id];
  const browserKey = [...scope, "browser", account.id];
  // Each connection episode refreshes the account snapshot once, when a status settles as connected.
  const connectedSeen = useRef({ oauth: false, browser: false });
  const settleStatus = (source: "oauth" | "browser", status: string | undefined) => {
    const before = connectedSeen.current.oauth || connectedSeen.current.browser;
    connectedSeen.current[source] = status === "connected";
    if (!before && connectedSeen.current[source] && !account.connected) void run(async () => undefined);
  };
  const settleRef = useRef(settleStatus);
  useLayoutEffect(() => {
    settleRef.current = settleStatus;
  });
  const oauthQuery = useQuery<OAuth | null>({
    queryKey: oauthKey,
    queryFn: async ({ signal }) => {
      let value: OAuth;
      try {
        value = await client.oauthStatus(account.id);
      } catch {
        value = {
          status: "failed",
          candidates: [],
          error: t("Connection status could not be read. Try again with Check connection."),
        };
      }
      signal.throwIfAborted();
      settleRef.current("oauth", value.status);
      return value;
    },
    enabled: active && visible && apiAccountType && !TOKEN_PLATFORMS.includes(account.platform),
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? 5_000 : false),
  });
  const browserQuery = useQuery<Browser | null>({
    queryKey: browserKey,
    queryFn: async ({ signal }) => {
      const value = await client.browserStatus(account.id);
      signal.throwIfAborted();
      settleRef.current("browser", value?.status);
      return value;
    },
    enabled: active && visible,
    staleTime: 3_000,
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? 3_000 : false),
  });
  const oauth = oauthQuery.data ?? null;
  const browser = browserQuery.data ?? null;
  const setOAuth = (value: OAuth | null) => {
    queryClient.setQueryData(oauthKey, value);
    settleStatus("oauth", value?.status);
  };
  const setBrowser = (value: Browser | null) => {
    queryClient.setQueryData(browserKey, value);
    settleStatus("browser", value?.status);
  };
  useEffect(() => {
    if (!active || !visible) return;
    let alive = true;
    void client
      .browserAvailability()
      .then((value) => alive && setBrowserAvailability(value))
      .catch(
        () =>
          alive &&
          setBrowserAvailability({
            available: false,
            reason: HOST_BROWSER_UNSUPPORTED,
          }),
      );
    return () => {
      alive = false;
    };
  }, [active, visible, client]);
  return (
    <>
              <AccountSummary
                account={account}
                capabilities={snapshot.capabilities[account.id] ?? []}
                onThisComputer={account.executorId === snapshot.executorId}
              >
                {account.connected && onPrepare ? (
                  <div className="social-actions">
                    <Button
                      disabled={socialLocked}
                      variant="primary"
                      type="button"
                      onClick={() => onPrepare?.(account.id)}
                    >
                      {t("Prepare content")}
                    </Button>
                    <Button
                      disabled={socialLocked}
                      variant="secondary"
                      type="button"
                      onClick={() => onOpenHistory?.(account.id)}
                    >
                      {t("View history")}
                    </Button>
                  </div>
                ) : null}
              </AccountSummary>
              {outcome ? <Notice kind={outcome.refreshFailed ? "warning" : outcome.success ? "success" : "error"} title={outcome.text} /> : null}
              <section className="flex min-w-0 flex-col gap-3" aria-label={t("Connection")}>
                <h3 className="text-ui-secondary font-medium">{t("Connection")}</h3>
              <SocialBrowserWorkspace
                key={socialBrowserWorkspaceKey(client, account)}
                account={account}
                client={client}
              />
              {
                <details className="social-connection" open={!account.connected || undefined}>
                  <summary>{t("Manage browser connection")}</summary>
                  <strong>
                    {account.connected && account.connection === "browser"
                      ? account.platform === "x"
                        ? t("X account connected")
                        : t("Account connected")
                      : account.platform === "x"
                        ? t("Connect your X account")
                        : t("Connect {p0} in the browser", { p0: names[account.platform] })}
                  </strong>
                  <details>
                    <summary>{t("How the browser connection works")}</summary>
                    <p>
                      {account.platform === "x"
                        ? t(
                            "Because the X API is paid, you can connect the account with your own X session. A separate Edge/Chrome window opens on the selected host; you sign in to X there yourself and close the window. Your password is never entered into bycoda. Approved posts are shared in the background with this session. Only post/image sharing and replies to a post ID are supported. Mentions and legacy web messaging are read through recognized reply formats; encrypted Chat is not supported. Continuous publishing and replies depend on an active publishing program and automation rules.",
                          )
                        : t(
                            "Use your own web session without an API subscription. Sign in in the separate Edge/Chrome window and close it when finished. The host verifies the saved identity. Supported actions use the existing approval queue; account identity, recipient and platform acknowledgement are checked before success is recorded.",
                          )}
                    </p>
                  </details>
                  {account.platform === "linkedin" && account.accountType === "organization" ? (
                    <TextField
                      label={t("LinkedIn Page ID or URL name")}
                      value={resourceId}
                      maxLength={100}
                      placeholder="bycoda"
                      disabled={socialLocked || browser?.status === "waiting"}
                      onChange={(event) => setResourceId(event.target.value.trim())}
                    />
                  ) : null}
                  <Notice kind="warning" title={t("Risk confirmation for browser connection")}>
                    {account.platform === "x"
                      ? t(
                          "This method is unofficial. If X detects automation, it may restrict or suspend the account.",
                        )
                      : t(
                          "Browser automation is unofficial. The platform may require manual verification or restrict the account.",
                        )}
                  </Notice>
                  <label className="social-inline-check">
                    <Checkbox
                      disabled={socialLocked}
                      checked={browserRisk}
                      onChange={(event) => setBrowserRisk(event.target.checked)}
                    />
                    {t("I understand the risk; use the browser session for this account")}
                  </label>
                  {browserAvailability && !browserAvailability.available ? (
                    <p>
                      {browserAvailability.reason === HOST_BROWSER_UNSUPPORTED
                        ? t(
                            "The selected host does not support browser-session connections. Update the Host and press Refresh.",
                          )
                        : t("Microsoft Edge or Google Chrome was not found on the selected host.")}
                    </p>
                  ) : null}
                  <div className="social-actions">
                    <Button
                      loading={pendingUi.is("accounts.sign-in-again-in-the-browser")}
                      type="button"
                      variant="primary"
                      disabled={
                        socialLocked ||
                        !browserRisk ||
                        !browserAvailability?.available ||
                        (account.platform === "linkedin" &&
                          account.accountType === "organization" &&
                          !/^web:linkedin:company:[\w-]+$/.test(account.platformId) &&
                          !/^[\w-]{1,100}$/.test(resourceId)) ||
                        browser?.status === "waiting"
                      }
                      onClick={() =>
                        void pendingUi.run("accounts.sign-in-again-in-the-browser", () =>
                          run(async () => {
                            await queryClient.cancelQueries({ queryKey: browserKey });
                            const status = await (account.platform === "linkedin" &&
                            account.accountType === "organization"
                              ? client.browserBegin(account.id, resourceId || undefined)
                              : client.browserBegin(account.id));
                            await queryClient.cancelQueries({ queryKey: browserKey });
                            setBrowser(status);
                          }),
                        )
                      }
                    >
                      {account.connected && account.connection === "browser"
                        ? t("Sign in again in the browser")
                        : account.platform === "x"
                          ? t("Sign in to X in the browser")
                          : t("Sign in in the browser")}
                    </Button>
                    <Button
                      loading={pendingUi.is("accounts.check-browser-connection")}
                      disabled={socialLocked}
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void pendingUi.run("accounts.check-browser-connection", () =>
                          run(async () => {
                            setBrowserAvailability(await client.browserAvailability());
                            setBrowser(await client.browserStatus(account.id));
                          }),
                        )
                      }
                    >
                      {t("Check browser connection")}
                    </Button>
                  </div>
                  {browser && browser.status !== "idle" ? (
                    <p role="status">
                      {browser.error ||
                        (
                          {
                            waiting:
                              account.platform === "x"
                                ? t(
                                    "Sign in to X in the Chrome window that opened (Google sign-in works too). Close the window yourself when you are done; bycoda then checks the session.",
                                  )
                                : t(
                                    "Complete sign-in and any verification in the opened browser. Close that window when finished; bycoda then verifies the saved account identity.",
                                  ),
                            connected:
                              account.platform === "x"
                                ? t("X account connected with the browser session.")
                                : t("Account connected"),
                            failed: t("Connection failed"),
                          } as Record<string, string>
                        )[browser.status]}
                    </p>
                  ) : null}
                </details>
              }
              {apiAccountType && TOKEN_PLATFORMS.includes(account.platform) ? (
                <div className="social-connection">
                  <strong>
                    {availabilityError ||
                      accountConnectionStatus(account, availability[account.platform])}
                  </strong>
                  <p>
                    {account.platform === "telegram" && account.accountType === "channel"
                      ? t(
                          "Publish to a verified Telegram channel with its administrator bot. Channel monitoring and private messages are separate capabilities.",
                        )
                      : account.platform === "telegram"
                        ? t(
                            "Read and reply to text messages with a bot account. Reading is off when a webhook already exists; bycoda does not delete other apps' webhooks.",
                          )
                        : t(
                            "Reply to incoming text messages with a WhatsApp Business account within the 24-hour reply window. Personal accounts, template messages and bulk first messages are not supported.",
                          )}
                  </p>
                  <details>
                    <summary>{t("Host connection settings")}</summary>
                    <p>
                      {t(
                        "Add the keys to the environment settings of the selected host service. The connect button verifies the account identity on the platform.",
                      )}
                    </p>
                    <code>BYCODA_SOCIAL_{account.platform.toUpperCase()}_TOKEN</code>
                    <br />
                    <code>BYCODA_SOCIAL_{account.platform.toUpperCase()}_APPROVED=1</code>
                    {account.platform === "whatsapp" ? (
                      <>
                        <br />
                        <code>BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID</code>
                        <br />
                        <code>BYCODA_SOCIAL_WHATSAPP_CLIENT_SECRET</code>
                        <br />
                        <code>BYCODA_SOCIAL_WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>
                        <p>
                          {t(
                            "Meta webhook address: /social/webhooks/whatsapp. Subscribe to the messages field on the business account.",
                          )}
                        </p>
                      </>
                    ) : null}
                  </details>
                  {account.platform === "telegram" && account.accountType === "channel" ? (
                    <TelegramChannelConnection
                      key={telegramConnectionKey(client, account)}
                      account={account}
                      client={client}
                      disabled={
                        socialLocked ||
                        !availability[account.platform]?.configured ||
                        !!availabilityError
                      }
                      onRefresh={() => run(async () => undefined)}
                    />
                  ) : (
                    <div className="social-actions">
                      <Button
                        loading={pendingUi.is("accounts.reconnect-host-account")}
                        type="button"
                        variant="primary"
                        disabled={
                          socialLocked ||
                          !availability[account.platform]?.configured ||
                          !!availabilityError
                        }
                        onClick={() =>
                          void pendingUi.run("accounts.reconnect-host-account", () =>
                            run(async () => {
                              await client.tokenConnect(account.id);
                            }),
                          )
                        }
                      >
                        {account.connected
                          ? t("Reconnect host account")
                          : t("Connect host account")}
                      </Button>
                    </div>
                  )}
                </div>
              ) : !apiAccountType ||
                (account.platform === "x" &&
                  account.connected &&
                  account.connection === "browser") ? null : (
                <Collapsible
                  collapsed={account.platform === "x"}
                  summary={t("Connect with the official X API (requires a paid developer app)")}
                >
                  {PROFILE_ONLY_PLATFORMS.includes(account.platform) ? (
                    <p role="note">
                      {t(
                        "This connection verifies the profile identity and lets you prepare drafts. Publishing, comments and inbox operations are not supported yet.",
                      )}
                    </p>
                  ) : null}
                  <div className="social-connection" role="status">
                    <strong>
                      {availabilityError
                        ? t("Connection check needed")
                        : accountConnectionStatus(
                            account,
                            availability[account.platform],
                            oauth?.status,
                          )}
                    </strong>
                    <p>
                      {availabilityError ||
                        (availability[account.platform] === undefined
                          ? t("Checking platform connection settings…")
                          : !availability[account.platform].configured
                            ? t(
                                "{p0} connection is not ready. Configure the platform app and its redirect address on the selected host.",
                                { p0: names[account.platform] },
                              )
                            : !account.connected && oauth?.status === "waiting"
                              ? t(
                                  "Sign in to your account and grant permission on the platform page that opened. The result is checked here automatically. If the page did not open, try again with Connect in browser.",
                                )
                              : !account.connected && oauth?.status === "selection"
                                ? t(
                                    "The platform verified your account. Choose the account you want to connect from the list below.",
                                  )
                                : account.connected &&
                                    account.expiresAt &&
                                    account.expiresAt < openedAt
                                  ? t(
                                      "The connection expired. Grant permission to your account again with Reconnect in browser.",
                                    )
                                  : account.connected
                                    ? t(
                                        "Account connected. Manage operations and project permissions below.",
                                      )
                                    : t(
                                        "Select permissions and press Connect in browser. Sign in to your account and grant permission on the platform page that opens; the result is checked here automatically.",
                                      ))}
                    </p>
                    {availability[account.platform]?.configured === false ? (
                      <details>
                        <summary>{t("Setup requirements")}</summary>
                        <p>
                          {t(
                            "These settings are not your social account password. Details from the platform developer app are added to the selected host service; do not enter secret keys here.",
                          )}
                        </p>
                        <ul>
                          <li>{t("App Client ID")}</li>
                          <li>
                            {account.platform === "x"
                              ? t(
                                  "Client Secret for apps that use a secret (optional for public PKCE)",
                                )
                              : t("App Client Secret")}
                          </li>
                          <li>
                            {t(
                              "Redirect address registered on the platform and reachable by the host",
                            )}
                          </li>
                        </ul>
                        <p>
                          {t(
                            "The host service environment settings use the names below. The settings cannot be edited in the app yet; add them through the host setup.",
                          )}
                        </p>
                        <code>BYCODA_SOCIAL_{account.platform.toUpperCase()}_CLIENT_ID</code>
                        <br />
                        <code>
                          BYCODA_SOCIAL_{account.platform.toUpperCase()}
                          _CLIENT_SECRET
                        </code>
                        <br />
                        <code>
                          BYCODA_SOCIAL_{account.platform.toUpperCase()}
                          _REDIRECT_URI
                        </code>
                        <p>
                          {t("Redirect address path on the host:")}{" "}
                          <code>/social/oauth/{account.platform}/callback</code>.{" "}
                          {t("The same address must also be registered in the platform app.")}
                        </p>
                        <p>{t("After updating the host settings, press Refresh.")}</p>
                      </details>
                    ) : null}
                  </div>
                  {PROFILE_ONLY_PLATFORMS.includes(account.platform) ? null : (
                    <fieldset className="social-checks">
                      <legend>{t("Capabilities requested through OAuth")}</legend>
                      {(snapshot.capabilities[account.id] ?? [])
                        .filter((capability) => capability.status !== "unsupported")
                        .map((capability) => (
                          <label key={capability.operation}>
                            <Checkbox
                              disabled={socialLocked}
                              checked={oauthOperations.includes(capability.operation)}
                              onChange={(event) =>
                                setOAuthOperations((current) =>
                                  event.target.checked
                                    ? [...current, capability.operation]
                                    : current.filter((item) => item !== capability.operation),
                                )
                              }
                            />
                            {operations[capability.operation]}
                          </label>
                        ))}
                    </fieldset>
                  )}
                  {PROFILE_ONLY_PLATFORMS.includes(account.platform) ? null : (
                    <p>
                      {t(
                        "Only the permissions of the selected API products are requested. Platform approval and webhook subscription are required separately.",
                      )}
                    </p>
                  )}
                  {account.accountType === "organization" ? (
                    <TextField
                      disabled={socialLocked}
                      label={t("LinkedIn organization ID")}
                      inputMode="numeric"
                      value={resourceId}
                      onChange={(event) => setResourceId(event.target.value)}
                    />
                  ) : null}
                  <div className="social-actions">
                    <Button
                      loading={pendingUi.is("accounts.reconnect-in-browser")}
                      type="button"
                      variant="primary"
                      disabled={
                        socialLocked ||
                        (!oauthOperations.length &&
                          !PROFILE_ONLY_PLATFORMS.includes(account.platform)) ||
                        !!availabilityError ||
                        !availability[account.platform]?.configured ||
                        (account.accountType === "organization" && !/^\d+$/.test(resourceId))
                      }
                      onClick={() =>
                        void pendingUi.run("accounts.reconnect-in-browser", () =>
                          run(async () => {
                            await queryClient.cancelQueries({ queryKey: oauthKey });
                            const begin = await client.oauthBegin(
                              account.id,
                              account.accountType === "organization" ? resourceId : undefined,
                              oauthOperations,
                            );
                            // A waiting poll may have started while begin was in flight.
                            await queryClient.cancelQueries({ queryKey: oauthKey });
                            setOAuth({ status: "waiting", candidates: [] });
                            await openUrl(begin.url);
                          }),
                        )
                      }
                    >
                      {account.connected ? t("Reconnect in browser") : t("Connect in browser")}
                    </Button>
                    <Button
                      loading={pendingUi.is("accounts.check-connection")}
                      disabled={socialLocked}
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void pendingUi.run("accounts.check-connection", () =>
                          run(async () => setOAuth(await client.oauthStatus(account.id))),
                        )
                      }
                    >
                      {t("Check connection")}
                    </Button>
                  </div>
                  {oauth && availability[account.platform]?.configured ? (
                    <div className="social-connection" role="status">
                      <p>
                        {oauth.error ||
                          (
                            {
                              idle: t(
                                "Connection not started. If platform setup is complete, start with Connect in browser.",
                              ),
                              waiting: t(
                                "Waiting for account permission in the browser. Grant permission on the platform page that opened. If the page did not open, try again with Connect in browser.",
                              ),
                              selection: t("Choose the verified account"),
                              connected: t("Account connected"),
                              failed: t("Connection failed"),
                            } as Record<string, string>
                          )[oauth.status]}
                      </p>
                      {(oauth.candidates ?? []).map((candidate) => (
                        <Button
                          loading={pendingUi.is(`accounts.connect:${candidate.id}`)}
                          disabled={socialLocked}
                          type="button"
                          variant="secondary"
                          key={candidate.id}
                          onClick={() =>
                            void pendingUi.run(`accounts.connect:${candidate.id}`, () =>
                              run(async () => {
                                await client.oauthSelect(account.id, candidate.id);
                                await queryClient.invalidateQueries({ queryKey: oauthKey });
                              }),
                            )
                          }
                        >
                          {t("{p0} · Connect", { p0: candidate.name })}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </Collapsible>
              )}
              </section>
              <div className="social-actions">
                <Button
                  loading={pendingUi.is("accounts.resume-account")}
                  disabled={socialLocked}
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void pendingUi.run("accounts.resume-account", () =>
                      run(() =>
                        client.request("accounts.pause", {
                          accountId: account.id,
                          paused: !account.paused,
                        }),
                      ),
                    )
                  }
                >
                  {account.paused ? t("Resume account") : t("Pause account")}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="ml-auto"
                  disabled={socialLocked || !account.connected}
                  onClick={() => setDisconnecting(true)}
                >
                  {t("Remove connection")}
                </Button>
              </div>
              {disconnecting ? (
                <ConfirmDialog
                  request={{
                    title: t("Remove the connection of {p0}?", { p0: account.name }),
                    message: t(
                      "The saved sign-in of {p0} is removed and the account is paused, so nothing is sent from it. The account entry, its project access and past activity stay.",
                      { p0: account.name },
                    ),
                    confirmLabel: t("Remove connection"),
                    onConfirm: async () => {
                      if (!(await run(() => client.request("accounts.disconnect", { accountId: account.id }))))
                        throw new Error(t("The connection could not be removed. Try again."));
                    },
                  }}
                  onSettle={() => setDisconnecting(false)}
                />
              ) : null}
              <details className="social-form social-account-capabilities">
                <summary>{t("Platform capabilities and requirements")}</summary>
                <section className="flex min-w-0 flex-col gap-2" aria-label={t("Effective operations")}>
                  <p className="text-ui-caption text-(--ui-text-secondary)">{account.executorId === snapshot.executorId ? t("This account is connected on the selected computer.") : t("This account is connected on another computer.")}</p>
                  <AccountCapabilities capabilities={snapshot.capabilities[account.id] ?? []} />
                </section>
              </details>
              <details className="social-form social-account-permissions" open>
                <summary>{t("Project access")}</summary>
                <p className="text-ui-caption text-(--ui-text-secondary)">{t("Project grants control permission. They do not establish a platform connection or approve a send.")}</p>
                <form
                  className="social-form"
                  onSubmit={(event) => {
                    field(event);
                    void pendingUi.run("accounts.save-permissions", () =>
                      run(() =>
                        client.request("accounts.grants", {
                          accountId: account.id,
                          projectId: grantProject,
                          permissions: grantPermissions,
                        }),
                      ),
                    );
                  }}
                >
                  <label>
                    {t("Project")}
                    <SearchableSelect
                      disabled={socialLocked}
                      value={grantProject}
                      label={t("Project")}
                      options={projects.map((project) => ({
                        value: project.id,
                        label: project.name,
                      }))}
                      onChange={(nextValue) => {
                        onGrantProjectChange(nextValue);
                        setGrantPermissions(account.grants[nextValue] ?? []);
                      }}
                      searchLocale={getLocale()}
                    />
                  </label>
                  <fieldset className="social-checks">
                    <legend>{t("Reading and sending are separate permissions")}</legend>
                    {[
                      ["read", t("Can read")],
                      ["draft", t("Prepare drafts")],
                      ["publish", t("Publish")],
                      ["reply", t("Can reply")],
                      ["message", t("New message")],
                      ["comment", t("Post a comment")],
                    ].map(([id, label]) => (
                      <label key={id}>
                        <Checkbox
                          disabled={socialLocked}
                          checked={grantPermissions.includes(id)}
                          onChange={(event) =>
                            setGrantPermissions(
                              event.target.checked
                                ? [...grantPermissions, id]
                                : grantPermissions.filter((item) => item !== id),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <Button
                    loading={pendingUi.is("accounts.save-permissions")}
                    type="submit"
                    variant="secondary"
                    disabled={socialLocked || !grantProject}
                  >
                    {t("Save permissions")}
                  </Button>
                  <ul className="social-account-grants" aria-label={t("Current project access")}>
                    {Object.entries(account.grants).map(([id, allowed]) => (
                      <li key={id}>
                        <strong>{projects.find((item) => item.id === id)?.name ?? id}</strong>
                        <span className="social-muted">
                          {allowed
                            .map((permission) => permissionLabels()[permission] ?? permission)
                            .join(", ") || t("none")}
                        </span>
                      </li>
                    ))}
                    {!Object.keys(account.grants).length ? (
                      <li className="social-muted">{t("No project has access yet.")}</li>
                    ) : null}
                  </ul>
                </form>
              </details>
    </>
  );
}
