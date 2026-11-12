import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { SettingsFeedback } from "./settingsControls";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
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
import { setHarnessModels } from "../../sessions/public/models";
import { Group } from "./settingsControls";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";

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
    <Text
      as="div"
      size="caption"
      tone="secondary"
      className={`space-y-3 ${embedded ? "" : "px-4 py-4"}`}
    >
      <p>
        {available
          ? t("Antigravity is installed.")
          : t("Install Antigravity CLI on the computer running your sessions.")}
      </p>
      {!available && (
        <>
          <p>{t("Windows (PowerShell)")}</p>
          <Code variant="block" tone="primary">
            {"irm https://antigravity.google/cli/install.ps1 | iex"}
          </Code>
          <p>{t("macOS / Linux")}</p>
          <Code variant="block" tone="primary">
            {"curl -fsSL https://antigravity.google/cli/install.sh | bash"}
          </Code>
        </>
      )}
      <p>
        {t("Run ")}
        <Code tone="primary" className="select-text">
          {"agy"}
        </Code>
        {t(
          " in a terminal on that computer and complete Google sign-in in your browser. Then check again here. Installation and model discovery do not confirm account sign-in.",
        )}
      </p>
      <p>
        {PRODUCT_IDENTITY.displayName}
        {t(
          " uses the shared Antigravity CLI account on this computer. Separate named Antigravity accounts cannot currently be added here. To change the shared account, run ",
        )}
        <Code>{"/logout"}</Code>
        {t(
          " inside agy and complete sign-in again. This affects other Antigravity sessions on the same computer.",
        )}
      </p>
      <p>
        {t("For a Gemini API key, set ")}
        <Code>{"modelProvider"}</Code>
        {t(" to")} <Code>{"gemini"}</Code>
        {t(" in")} <Code>{"~/.gemini/antigravity-cli/settings.json"}</Code>
        {t(" and provide")} <Code>{"GEMINI_API_KEY"}</Code>
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
    </Text>
  );
  if (embedded)
    return (
      <Disclosure
        id="setting-antigravity-account"
        data-setting-id="antigravity-account"
        variant="card"
        className="provider-antigravity-box"
        open={expanded}
        onOpenChange={setExpanded}
        summary={
          <span className="flex min-w-0 items-center gap-2.5 py-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--ui-surface-muted) ring-1 ring-inset ring-stroke">
              <HarnessIcon harness="antigravity" className="icon-md" />
            </span>
            <span className="min-w-0">
              <Text as="span" tone="primary" weight="medium" className="block">
                {t("Antigravity CLI account")}
              </Text>
              <Text size="micro" tone="muted" className="block">
                {t("This machine · shared CLI account · separate profiles unavailable")}
              </Text>
            </span>
          </span>
        }
      >
        {instructions}
      </Disclosure>
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
