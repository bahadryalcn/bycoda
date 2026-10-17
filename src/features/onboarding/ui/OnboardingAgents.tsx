import { Alert } from "../../../shared/ui/Alert";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Plus, RefreshCw } from "../../../shared/ui/icons";
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
const GenericAcpSettings = lazy(() =>
  import("../../providers/ui/GenericAcpSettings").then((module) => ({
    default: module.GenericAcpSettings,
  })),
);

const INSTALL_GUIDES: Partial<Record<HarnessId, string>> = {
  codex: "https://help.openai.com/en/articles/11096431",
  claude: "https://support.claude.com/en/articles/14552382-your-first-day-in-claude-code",
  gemini: "https://geminicli.com/docs/get-started/installation/",
};

export function OnboardingAgents({
  onSignIn,
  signedIn,
  providers,
  onAddProviders,
}: {
  onSignIn: (harness: HarnessId) => void;
  signedIn: ReadonlySet<HarnessId>;
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
  const [adding, setAdding] = useState("");
  const [custom, setCustom] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const refresh = () => {
    setChecking(true);
    setError("");
    void probeHarnessAvailability({ force: true })
      .then(() => {
        if (alive.current) onAddProviders(HARNESSES.filter(isHarnessAvailable));
      })
      .catch((reason) => {
        if (alive.current) setError(String(reason));
      })
      .finally(() => {
        if (alive.current) setChecking(false);
      });
  };
  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, []);

  return (
    <>
      <div className="onboarding-heading">
        <h3>{t("Connect your agents")}</h3>
        <p>
          {t("Use your existing accounts, or add a provider. Installed does not mean signed in.")}
        </p>
      </div>
      <div className="onboarding-agent-list">
        {providers.map((provider) => {
          const available = isHarnessAvailable(provider);
          const visible = isPickerProviderVisible(provider);
          return (
            <div className="onboarding-agent" key={provider}>
              <label className="onboarding-agent-choice">
                <HarnessIcon harness={provider} className="size-5 shrink-0" />
                <div>
                  <strong>{HARNESS_TITLE[provider]}</strong>
                  <small>
                    {checking
                      ? t("Checking installation…")
                      : signedIn.has(provider)
                        ? t("✓ Signed in")
                        : available
                          ? t("CLI installed · sign in with your provider account")
                          : t("Install the CLI, then refresh to continue")}
                  </small>
                </div>
                <Checkbox
                  aria-label={t("Use {p0}", { p0: HARNESS_TITLE[provider] })}
                  checked={visible}
                  onChange={(event) => savePickerProviderVisible(provider, event.target.checked)}
                />
              </label>
              <div className="onboarding-agent-actions">
                <ProviderBinaryControl provider={provider} />
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
                ) : supportsHarnessLogin(provider) ? (
                  <Button
                    disabled={checking || !available}
                    onClick={() => onSignIn(provider)}
                    variant="secondary"
                    type="button"
                  >
                    {t("Sign in")}
                  </Button>
                ) : (
                  <small>{t("Configure authentication in your provider")}</small>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {HARNESSES.some((id) => !providers.includes(id)) ? (
        <div className="onboarding-add-provider">
          <label className="onboarding-provider-select">
            <span>{t("More providers")}</span>
            <NativeSearchableSelect
              label={t("More providers")}
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              options={[
                { value: "", label: t("Choose a provider") },
                ...HARNESSES.filter((id) => !providers.includes(id)).map((id) => ({
                  value: id,
                  label: HARNESS_TITLE[id],
                })),
              ]}
            />
          </label>
          <Button
            disabled={!adding}
            onClick={() => {
              const id = adding as HarnessId;
              onAddProviders([id]);
              savePickerProviderVisible(id, true);
              setAdding("");
              if (id === "acp") setCustom(true);
            }}
            variant="secondary"
            type="button"
          >
            <Plus className="size-3.5" />
            {t("Add provider")}
          </Button>
        </div>
      ) : null}
      <div className="onboarding-agent-help">
        <p>
          {t("Already signed in through the CLI? Your existing account is used automatically.")}
        </p>
        <Button disabled={checking} onClick={refresh} variant="secondary" type="button">
          <RefreshCw className="size-3.5" />
          {t("Refresh agent status")}
        </Button>
      </div>
      {error ? (
        <Alert role="alert" tone="danger">
          {error}
        </Alert>
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
