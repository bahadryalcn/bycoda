import { SettingsFeedback } from "./settingsControls";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { discoverAntigravityModels } from "../../../integrations/harness/providers/antigravity/antigravityCatalog";
import { setHarnessModels } from "../../sessions/model/models";
import { Group } from "./settingsControls";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";

export function AntigravityAccountSettings({ embedded = false }: { embedded?: boolean }) {
  useLocale();
  useSyncExternalStore(subscribeHarnessAvailability, getHarnessAvailabilitySnapshot);
  const [checking, setChecking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const available = isHarnessAvailable("antigravity");

  async function checkInstallation() {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setStatus(null);
    setError(null);
    try {
      await probeHarnessAvailability({ force: true });
      if (!isHarnessAvailable("antigravity")) {
        setStatus("Antigravity CLI was not found. Install it, then check again.");
        return;
      }
      const models = await discoverAntigravityModels();
      if (!models.length)
        throw new Error(
          "No Antigravity models were returned. Run agy in a terminal to sign in, then check again.",
        );
      setHarnessModels("antigravity", models);
      setStatus("Antigravity models refreshed. Choose Antigravity in the model picker.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not check Antigravity CLI.");
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  const instructions = (
    <div className="space-y-3 px-4 py-4 text-ui-caption text-(--ui-text-secondary)">
      <p>
        {available
          ? t("Antigravity is installed.")
          : t("Install Antigravity CLI on the computer running your sessions.")}
      </p>
      {!available && (
        <>
          <p>{t("Windows (PowerShell)")}</p>
          <code className="block select-text rounded-md bg-(--ui-surface-muted) px-3 py-2 text-content">
            {"irm https://antigravity.google/cli/install.ps1 | iex"}
          </code>
          <p>{t("macOS / Linux")}</p>
          <code className="block select-text rounded-md bg-(--ui-surface-muted) px-3 py-2 text-content">
            {"curl -fsSL https://antigravity.google/cli/install.sh | bash"}
          </code>
        </>
      )}
      <p>
        {t("Run ")}
        <code className="select-text text-content">{"agy"}</code>
        {t(
          " in a terminal on that computer and complete Google sign-in in your browser. Then check again here. Installation and model discovery do not confirm account sign-in.",
        )}
      </p>
      <p>
        {PRODUCT_IDENTITY.displayName}
        {t(
          " uses the shared Antigravity CLI account on this computer. Separate named Antigravity accounts cannot currently be added here. To change the shared account, run ",
        )}
        <code>{"/logout"}</code>
        {t(
          " inside agy and complete sign-in again. This affects other Antigravity sessions on the same computer.",
        )}
      </p>
      <p>
        {t("For a Gemini API key, set ")}
        <code>{"modelProvider"}</code>
        {t(" to")} <code>{"gemini"}</code>
        {t(" in")} <code>{"~/.gemini/antigravity-cli/settings.json"}</code>
        {t(" and provide")} <code>{"GEMINI_API_KEY"}</code>
        {t(" in the CLI environment.")}
      </p>
      <p>
        {t(
          "Gemini CLI remains available for enterprise Gemini Code Assist licenses and supported API keys. Existing Gemini sessions and CLI paths are preserved.",
        )}
      </p>
      <Button className="shrink-0" loading={checking} onClick={() => void checkInstallation()}>
        {checking ? t("Checking…") : t("Check installation and models")}
      </Button>
      {!checking && status ? (
        <SettingsFeedback state={available ? "success" : "warning"}>{t(status)}</SettingsFeedback>
      ) : null}
      {error && <SettingsFeedback state="error">{t(error)}</SettingsFeedback>}
    </div>
  );
  if (embedded)
    return (
      <div
        id="setting-antigravity-account"
        data-setting-id="antigravity-account"
        className="border-t border-stroke"
      >
        <div className="flex flex-wrap items-center gap-4 px-4 py-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--ui-surface-muted) ring-1 ring-inset ring-stroke">
              <HarnessIcon harness="antigravity" className="icon-md" />
            </span>
            <div className="min-w-0">
              <p className="text-ui-caption font-medium text-content">
                {t("Antigravity CLI account")}
              </p>
              <p className="text-ui-micro text-(--ui-text-muted)">
                {t("This machine · shared CLI account · separate profiles unavailable")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-expanded={expanded}
            aria-controls="antigravity-account-setup"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t("Hide account setup") : t("Set up account")}
          </Button>
        </div>
        <div
          id="antigravity-account-setup"
          hidden={!expanded}
          className="border-t border-stroke bg-(--ui-surface-muted)"
        >
          {instructions}
        </div>
      </div>
    );
  return (
    <Group
      id="antigravity-account"
      title={t("Antigravity CLI account")}
      description={t(
        "Google's terminal experience for individual accounts has moved from Gemini CLI to Antigravity CLI. Choose Antigravity in the model picker.",
      )}
    >
      {instructions}
    </Group>
  );
}
