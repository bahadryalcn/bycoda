import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Plus, RefreshCw } from "../../../shared/ui/icons";
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
          <h3>{t("Connect your agents")}</h3>
          <p>{t("Use the providers found on this computer, or add one from another location.")}</p>
        </div>
        <Button
          iconOnly
          label={t("Refresh agent status")}
          variant="ghost"
          loading={checking}
          onClick={refresh}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {checking && listed.length === 0 ? <p role="status">{t("Scanning this computer…")}</p> : null}
      {!checking && listed.length === 0 ? (
        <div className="onboarding-provider-empty" role="status">
          <strong>{t("No providers found")}</strong>
          <p>{t("Already installed one? Choose its executable, or install it and scan again.")}</p>
        </div>
      ) : null}
      <div className="onboarding-agent-list">
        {listed.map((provider) => {
          const available = isHarnessAvailable(provider);
          const visible = isPickerProviderVisible(provider);
          const accountId = supportsProviderAccounts(provider)
            ? defaultProviderAccountId(provider)
            : "default";
          const connected =
            signedIn.has(`${provider}:${accountId}`) || auth[provider] === "signedIn";
          const restartRequired = providerBinaryPathChangePending(provider);
          return (
            <div className="onboarding-agent" key={provider}>
              <div className="onboarding-agent-identity">
                <HarnessIcon harness={provider} className="size-5 shrink-0" />
                <div>
                  <strong>{HARNESS_TITLE[provider]}</strong>
                  <small role="status">
                    {checking
                      ? t("Checking installation…")
                      : restartRequired
                        ? t("CLI path saved · restart required")
                        : provider === "acp"
                          ? available
                            ? t("ACP agents configured")
                            : t("No ACP agents configured")
                          : connected
                            ? t("Signed in")
                            : available
                              ? auth[provider] === "signedOut"
                                ? t("CLI installed · not signed in")
                                : auth[provider] === undefined
                                  ? t("Checking existing CLI account…")
                                  : t("CLI installed · sign-in status unavailable")
                              : t("CLI not found · choose its executable or install it")}
                  </small>
                </div>
              </div>
              <div className="onboarding-agent-actions">
                <Checkbox
                  aria-label={t("Use {p0}", { p0: HARNESS_TITLE[provider] })}
                  checked={visible}
                  onChange={(event) => savePickerProviderVisible(provider, event.target.checked)}
                />
                {provider !== "acp" ? (
                  <ProviderBinaryControl provider={provider} onPathSaved={refresh} />
                ) : null}
                {supportsProviderAccounts(provider) ? (
                  <TerminalProfileDiscovery
                    provider={provider}
                    disabled={checking}
                    autoDiscover
                    showLabel={false}
                    onConnected={(account) =>
                      setDefaultProviderAccount(account.provider, account.id)
                    }
                  />
                ) : null}
                {provider === "acp" ? (
                  <Button onClick={() => setCustom(true)} variant="secondary" type="button">
                    {t("Configure")}
                  </Button>
                ) : null}
                {!checking && !available && INSTALL_GUIDES[provider] ? (
                  <Button
                    onClick={() =>
                      void openUrl(INSTALL_GUIDES[provider]!).catch((reason) => {
                        if (alive.current) setError(String(reason));
                      })
                    }
                    variant="secondary"
                    type="button"
                  >
                    {t("Install guide ↗")}
                  </Button>
                ) : !checking && available && supportsHarnessLogin(provider) && !connected ? (
                  <Button
                    aria-label={t("Sign in to {p0}", { p0: HARNESS_TITLE[provider] })}
                    disabled={checking || !available || restartRequired}
                    onClick={() => onSignIn(provider)}
                    variant="secondary"
                    type="button"
                  >
                    {t("Sign in")}
                  </Button>
                ) : null}
                {SETUP_COMMANDS[provider] ? (
                  <Button onClick={() => setSetup(provider)} variant="secondary" type="button">
                    {t("Configure")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="onboarding-provider-footer">
        {missing.length > 0 ? (
          <Button
            disabled={checking}
            onClick={() => setAdding(true)}
            variant="secondary"
            type="button"
          >
            <Plus className="size-4" />
            {t("Add provider")}
          </Button>
        ) : null}
        {listed.length > 0 ? (
          <p>
            {t("Existing CLI accounts are reused. Choose another account from its profile menu.")}
          </p>
        ) : null}
      </div>
      {error ? (
        <Alert role="alert" tone="danger">
          {error}
        </Alert>
      ) : null}
      {adding ? (
        <Modal title={t("Add provider")} size="sm" onClose={closeAdd}>
          <div className="onboarding-provider-add">
            <div className="onboarding-provider-select">
              <span>{t("Provider")}</span>
              <SearchableSelect
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
              <p>{t("Choose a provider, then select its CLI executable or enter its path.")}</p>
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
          <code className="select-text break-words">{SETUP_COMMANDS[setup]}</code>
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
          <div className="onboarding-settings">
            <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
              <GenericAcpSettings />
            </Suspense>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
