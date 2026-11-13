import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { Code } from "../../../shared/ui/Code";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Heading } from "../../../shared/ui/Heading";
import { Popover } from "../../../shared/ui/Popover";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { Spinner } from "../../../shared/ui/Spinner";
import { Switch } from "../../../shared/ui/Switch";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { MoreHorizontal, Plus, RefreshCw } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { supportsHarnessLogin } from "../../../integrations/harness/core/authSupport";
import {
  getHarnessAvailabilitySnapshot,
  subscribeHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import {
  getPickerVisibilitySnapshot,
  subscribePickerVisibility,
  isPickerProviderVisible,
  savePickerProviderVisible,
} from "../../sessions/model/models";
import { ProviderBinaryControl } from "../../settings/ui/ProviderBinarySettings";
import { TerminalProfileDiscovery } from "../../settings/ui/TerminalProfileDiscovery";
import {
  defaultProviderAccountId,
  setDefaultProviderAccount,
  supportsProviderAccounts,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  loadProviderBinaryPath,
  providerBinaryPathChangePending,
} from "../../providers/model/providerBinaryPaths";
import {
  readHarnessAuthStatus,
  type HarnessAuthStatus,
} from "../../../integrations/harness/core/authStatus";
import { LoadingText } from "../../../shared/ui/LoadingText";
const GenericAcpSettings = lazy(() =>
  import("../../providers/ui/GenericAcpSettings").then((module) => ({
    default: module.GenericAcpSettings,
  })),
);

const INSTALL_GUIDES: Partial<Record<HarnessId, string>> = {
  codex: "https://help.openai.com/en/articles/11096431",
  claude: "https://support.claude.com/en/articles/14552382-your-first-day-in-claude-code",
};

// These providers select upstream credentials interactively rather than offering
// one account-wide OAuth login. Show their real setup entry point.
const SETUP_COMMANDS: Partial<Record<HarnessId, string>> = {
  opencode: "opencode auth login",
  pi: "pi → /login",
  omp: "omp → /login",
  hermes: "hermes model",
  antigravity: "agy",
};

export function OnboardingAgents({
  onSignIn,
  signedIn,
  providers,
  onAddProviders,
}: {
  onSignIn: (harness: HarnessId) => void;
  signedIn: ReadonlySet<string>;
  providers: HarnessId[];
  onAddProviders: (ids: readonly HarnessId[]) => void;
}) {
  useLocale();
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const [custom, setCustom] = useState(false);
  const [adding, setAdding] = useState(false);
  const [candidate, setCandidate] = useState<HarnessId | "">("");
  const [setup, setSetup] = useState<HarnessId | null>(null);
  const [auth, setAuth] = useState<Partial<Record<HarnessId, HarnessAuthStatus>>>({});
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const scan = useRef(0);
  const refresh = useCallback(() => {
    const revision = ++scan.current;
    const current = () => alive.current && scan.current === revision;
    setChecking(true);
    setError("");
    setAuth({});
    void probeHarnessAvailability({ force: true })
      .then(() => {
        if (!current()) return;
        // Publish each account independently; a slow CLI must not hold up the others.
        for (const provider of HARNESSES.filter(isHarnessAvailable)) {
          const accountId = supportsProviderAccounts(provider)
            ? defaultProviderAccountId(provider)
            : undefined;
          void readHarnessAuthStatus(provider, accountId).then((status) => {
            if (current()) setAuth((previous) => ({ ...previous, [provider]: status }));
          });
        }
      })
      .catch((reason) => {
        if (current()) setError(String(reason));
      })
      .finally(() => {
        if (current()) setChecking(false);
      });
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const unsubscribe = subscribeProviderAccounts(refresh);
    return () => {
      alive.current = false;
      scan.current += 1;
      unsubscribe();
    };
  }, [refresh]);

  const listed = HARNESSES.filter(
    (provider) =>
      isHarnessAvailable(provider) ||
      providers.includes(provider) ||
      Boolean(loadProviderBinaryPath(provider)),
  );
  const missing = HARNESSES.filter((provider) => !listed.includes(provider));
  const closeAdd = () => {
    setAdding(false);
    setCandidate("");
  };
  const added = (provider: HarnessId) => {
    onAddProviders([provider]);
    savePickerProviderVisible(provider, true);
    closeAdd();
    refresh();
  };

  return (
    <>
      <div className="onboarding-provider-heading">
        <div className="onboarding-heading">
          <Heading size="page" level={3}>
            {t("Connect your agents")}
          </Heading>
          <Text as="p" size="inherit" tone="muted" leading="normal">
            {t("Use the providers found on this computer, or add one from another location.")}
          </Text>
        </div>
        <Button
          iconOnly
          label={t("Refresh agent status")}
          variant="ghost"
          loading={checking}
          onClick={refresh}
        >
          <RefreshCw className="icon-md" />
        </Button>
      </div>
      <div className="onboarding-scroll">
        {checking && listed.length === 0 ? (
          <>
            <LoadingText>{t("Scanning this computer…")}</LoadingText>
            <div className="onboarding-agent-skeleton" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} aria-hidden className="h-9 w-full" />
              ))}
            </div>
          </>
        ) : null}
        {!checking && listed.length === 0 ? (
          <div className="onboarding-provider-empty" role="status">
            <EmptyState size="inline" kind="empty" description={t("No providers found")} />
            <Text as="p" size="caption" tone="secondary" leading="normal">
              {t("Already installed one? Choose its executable, or install it and scan again.")}
            </Text>
          </div>
        ) : null}
        <div
          {...surfaceAttributes(
            { frame: "stroke", edge: "block", dividers: "stroke" },
            "onboarding-agent-list",
          )}
        >
          {listed.map((provider) => {
            const available = isHarnessAvailable(provider);
            const visible = isPickerProviderVisible(provider);
            const accountId = supportsProviderAccounts(provider)
              ? defaultProviderAccountId(provider)
              : "default";
            const connected =
              signedIn.has(`${provider}:${accountId}`) || auth[provider] === "signedIn";
            const restartRequired = providerBinaryPathChangePending(provider);
            const title = HARNESS_TITLE[provider];
            const guide = INSTALL_GUIDES[provider];
            let busy = false;
            let status: string;
            if (checking) {
              busy = true;
              status = t("Checking…");
            } else if (restartRequired) {
              status = t("CLI path saved · restart required");
            } else if (provider === "acp") {
              status = available ? t("ACP agents configured") : t("No ACP agents configured");
            } else if (connected) {
              status = t("Signed in");
            } else if (!available) {
              status = t("Not installed");
            } else if (auth[provider] === "signedOut") {
              status = t("Not signed in");
            } else if (auth[provider] === undefined) {
              busy = true;
              status = t("Checking…");
            } else {
              status = t("Sign-in not checked");
            }
            // One primary action per row, in a fixed column. CLI path and account live in the overflow.
            let primary: ReactNode = null;
            let cliSetupIsPrimary = false;
            if (provider === "acp") {
              primary = (
                <Button onClick={() => setCustom(true)} variant="secondary" type="button">
                  {t("Configure")}
                </Button>
              );
            } else if (!checking && !available && guide) {
              primary = (
                <Button
                  onClick={() =>
                    void openUrl(guide).catch((reason) => {
                      if (alive.current) setError(String(reason));
                    })
                  }
                  variant="secondary"
                  type="button"
                >
                  {t("Install guide ↗")}
                </Button>
              );
            } else if (!checking && !available) {
              cliSetupIsPrimary = true;
              primary = (
                <ProviderBinaryControl
                  key={provider}
                  provider={provider}
                  showLabel
                  onPathSaved={refresh}
                />
              );
            } else if (!checking && available && supportsHarnessLogin(provider) && !connected) {
              primary = (
                <Button
                  aria-label={t("Sign in to {p0}", { p0: title })}
                  disabled={restartRequired}
                  onClick={() => onSignIn(provider)}
                  variant="secondary"
                  type="button"
                >
                  {t("Sign in")}
                </Button>
              );
            } else if (SETUP_COMMANDS[provider]) {
              primary = (
                <Button onClick={() => setSetup(provider)} variant="secondary" type="button">
                  {t("Configure")}
                </Button>
              );
            }
            const hasMore =
              (provider !== "acp" && !cliSetupIsPrimary) ||
              supportsProviderAccounts(provider) ||
              available;
            return (
              <div className="onboarding-agent" key={provider}>
                <div className="onboarding-agent-identity">
                  <HarnessIcon harness={provider} className="size-5 shrink-0" />
                  <div>
                    <Text
                      as="strong"
                      size="secondary"
                      tone="inherit"
                      weight="medium"
                      leading="inherit"
                    >
                      {title}
                    </Text>
                    <Text
                      as="small"
                      role="status"
                      size="caption"
                      tone="secondary"
                      leading="normal"
                      className="onboarding-agent-status"
                    >
                      {busy ? <Spinner size="xs" /> : null}
                      <Text as="span" size="inherit" tone="inherit" wrap="anywhere">
                        {status}
                      </Text>
                    </Text>
                  </div>
                </div>
                <div className="onboarding-agent-controls">
                  <span className="onboarding-agent-primary">{primary}</span>
                  <Tooltip label={t("Show in picker")} asChild>
                    <span className="onboarding-agent-visibility">
                      <Switch
                        aria-label={t("Use {p0}", { p0: title })}
                        checked={visible}
                        onCheckedChange={(next) => savePickerProviderVisible(provider, next)}
                      />
                    </span>
                  </Tooltip>
                  <span className="onboarding-agent-more">
                    {hasMore ? (
                      <AgentMore label={t("More options for {p0}", { p0: title })}>
                        {provider !== "acp" && !cliSetupIsPrimary ? (
                          <ProviderBinaryControl
                            key={provider}
                            provider={provider}
                            showLabel
                            onPathSaved={refresh}
                          />
                        ) : null}
                        {supportsProviderAccounts(provider) ? (
                          <TerminalProfileDiscovery
                            key={provider}
                            provider={provider}
                            disabled={checking}
                            autoDiscover
                            onConnected={(account) =>
                              setDefaultProviderAccount(account.provider, account.id)
                            }
                          />
                        ) : null}
                        {available ? (
                          <Button variant="ghost" size="sm" disabled={checking} onClick={refresh}>
                            <RefreshCw className="icon-sm" />
                            {t("Check again")}
                          </Button>
                        ) : null}
                      </AgentMore>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {missing.length > 0 ? (
          <div className="onboarding-provider-footer">
            <Button
              disabled={checking}
              onClick={() => setAdding(true)}
              variant="secondary"
              type="button"
            >
              <Plus className="icon-md" />
              {t("Add provider")}
            </Button>
            <InfoPopover label={t("About existing accounts")}>
              <p>
                {t(
                  "Existing CLI accounts are reused. Choose another account from its profile menu.",
                )}
              </p>
            </InfoPopover>
          </div>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
      {adding ? (
        <Modal title={t("Add provider")} size="sm" onClose={closeAdd}>
          <div className="onboarding-provider-add">
            <div className="onboarding-provider-select">
              <Text as="span" size="caption" tone="secondary">
                {t("Provider")}
              </Text>
              <SearchableSelect
                hideLabel
                label={t("Provider")}
                value={candidate}
                onChange={(value) => setCandidate(value as HarnessId)}
                options={missing.map((provider) => ({
                  value: provider,
                  label: HARNESS_TITLE[provider],
                }))}
                placeholder={t("Choose a provider…")}
                searchPlaceholder={t("Search providers…")}
              />
            </div>
            {candidate && candidate !== "acp" ? (
              <>
                <ProviderBinaryControl
                  key={candidate}
                  provider={candidate}
                  inline
                  onCancel={closeAdd}
                  onPathSaved={() => added(candidate)}
                />
                {INSTALL_GUIDES[candidate] ? (
                  <Button
                    variant="link"
                    onClick={() =>
                      void openUrl(INSTALL_GUIDES[candidate]!).catch((reason) =>
                        setError(String(reason)),
                      )
                    }
                  >
                    {t("Install guide ↗")}
                  </Button>
                ) : null}
              </>
            ) : candidate === "acp" ? (
              <Button
                onClick={() => {
                  added("acp");
                  setCustom(true);
                }}
              >
                {t("Configure")}
              </Button>
            ) : (
              <Text as="p" size="caption" tone="secondary" leading="normal">
                {t("Choose a provider, then select its CLI executable or enter its path.")}
              </Text>
            )}
          </div>
        </Modal>
      ) : null}
      {setup ? (
        <Modal
          title={t("Set up {p0}", { p0: HARNESS_TITLE[setup] })}
          size="sm"
          onClose={() => setSetup(null)}
        >
          <p>
            {t(
              "Run this in a terminal on the computer running your sessions, then refresh agent status.",
            )}
          </p>
          <Code className="select-text break-words">{SETUP_COMMANDS[setup]}</Code>
          <p>
            {t(
              "Your provider manages its own credentials. Existing accounts are reused when you start a conversation.",
            )}
          </p>
        </Modal>
      ) : null}
      {custom ? (
        <Modal
          title={t("ACP Agent")}
          size="lg"
          onClose={() => {
            setCustom(false);
            refresh();
          }}
        >
          <Suspense fallback={<SurfaceLoading />}>
            <GenericAcpSettings />
          </Suspense>
        </Modal>
      ) : null}
    </>
  );
}

/** Quiet overflow for per-provider setup (CLI path, accounts). Nested dialogs stay owned by their controls. */
function AgentMore({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        iconOnly
        label={label}
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="icon-md" />
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          role="dialog"
          aria-label={label}
          align="end"
          minWidth={220}
          autoFocus
          onDismiss={() => setOpen(false)}
          className="onboarding-agent-menu"
        >
          {children}
        </Popover>
      ) : null}
    </>
  );
}
