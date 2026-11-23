import { Code } from "../../../shared/ui/Code";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { RevealedSetting, SettingsFeedback } from "../../../shared/ui/settings";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { discoverAntigravityModels } from "../../../integrations/harness/providers/antigravity/antigravityCatalog";
import { setHarnessModels } from "../../sessions/public/models";
import { Group } from "../../../shared/ui/settings";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";

const SLOT_PASSTHROUGH = { p0: "{p0}", p1: "{p1}", p2: "{p2}", p3: "{p3}" };

/** Fills `{pN}` slots of an already translated sentence with nodes, keeping word order per locale. */
function withSlots(sentence: string, slots: ReactNode[]): ReactNode[] {
  return sentence.split(/(\{p\d\})/).map((part) => {
    const slot = /^\{p(\d)\}$/.exec(part);
    return slot ? (slots[Number(slot[1])] ?? part) : part || null;
  });
}

export function AntigravityAccountSettings({ embedded = false }: { embedded?: boolean }) {
  useLocale();
  useSyncExternalStore(subscribeHarnessAvailability, getHarnessAvailabilitySnapshot);
  const [checking, setChecking] = useState(false);
  const revealed = useContext(RevealedSetting);
  const [expanded, setExpanded] = useState(revealed === "antigravity-account");
  const [handledReveal, setHandledReveal] = useState(revealed);
  if (handledReveal !== revealed) {
    setHandledReveal(revealed);
    if (revealed === "antigravity-account") setExpanded(true);
  }
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const available = isHarnessAvailable("antigravity");

  async function checkInstallation(force = true) {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setError(null);
    try {
      await probeHarnessAvailability({ force });
      if (!isHarnessAvailable("antigravity")) return;
      const models = await discoverAntigravityModels();
      if (!models.length)
        throw new Error(
          "No Antigravity models were returned. Run agy in a terminal to sign in, then check again.",
        );
      setHarnessModels("antigravity", models);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not check Antigravity CLI.");
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  const autoCheck = useEffectEvent(() => void checkInstallation(false));
  // Refresh the installation and catalog when setup is shown.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- checks the installed CLI when the account settings are visible
  useEffect(() => {
    if (!embedded || expanded) autoCheck();
  }, [embedded, expanded]);

  const instructions = (
    <Text
      as="div"
      size="caption"
      tone="secondary"
      className={`space-y-3 ${embedded ? "" : "px-4 py-4"}`}
    >
      <div className="flex items-center gap-1">
        {!available && !checking ? (
          <p>{t("Install Antigravity CLI on the computer running your sessions.")}</p>
        ) : null}
        <InfoPopover className="shrink-0" width={360}>
          <p>
            {withSlots(
              t(
                "Run {p0} in a terminal on that computer and complete Google sign-in in your browser. Then check again here. Installation and model discovery do not confirm account sign-in.",
                SLOT_PASSTHROUGH,
              ),
              [
                <Code key="agy" tone="primary" className="select-text">
                  {"agy"}
                </Code>,
              ],
            )}
          </p>
          <p>
            {withSlots(
              t(
                "{p0} uses the shared Antigravity CLI account on this computer. Separate named Antigravity accounts cannot currently be added here. To change the shared account, run {p1} inside agy and complete sign-in again. This affects other Antigravity sessions on the same computer.",
                SLOT_PASSTHROUGH,
              ),
              [PRODUCT_IDENTITY.displayName, <Code key="logout">{"/logout"}</Code>],
            )}
          </p>
          <p>
            {withSlots(
              t(
                "For a Gemini API key, set {p0} to {p1} in {p2} and provide {p3} in the CLI environment.",
                SLOT_PASSTHROUGH,
              ),
              [
                <Code key="provider">{"modelProvider"}</Code>,
                <Code key="gemini">{"gemini"}</Code>,
                <Code key="settings">{"~/.gemini/antigravity-cli/settings.json"}</Code>,
                <Code key="key">{"GEMINI_API_KEY"}</Code>,
              ],
            )}
          </p>
          <p>
            {t(
              "Gemini CLI remains available for enterprise Gemini Code Assist licenses and supported API keys. Existing Gemini sessions and CLI paths are preserved.",
            )}
          </p>
        </InfoPopover>
      </div>
      {!available && !checking && (
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
      {checking ? <SettingsFeedback state="loading">{t("Checking…")}</SettingsFeedback> : null}
      {!checking && (!available || error) ? (
        <Button onClick={() => void checkInstallation()}>{t("Retry")}</Button>
      ) : null}
      {error ? <SettingsFeedback state="error">{t(error)}</SettingsFeedback> : null}
    </Text>
  );
  if (embedded)
    return (
      <Disclosure
        id="setting-antigravity-account"
        data-setting-id="antigravity-account"
        variant="card"
        {...surfaceAttributes({ variant: "card" }, "provider-antigravity-box")}
        open={expanded}
        onOpenChange={setExpanded}
        summary={
          <span className="flex min-w-0 items-center gap-2.5 py-3">
            <span
              {...surfaceAttributes(
                { variant: "inset", radius: "card", ring: "pane" },
                "grid size-7 shrink-0 place-items-center",
              )}
            >
              <HarnessIcon harness="antigravity" className="icon-md" />
            </span>
            <Text as="span" tone="primary" weight="medium" className="block min-w-0">
              {t("Setup")}
            </Text>
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
