import { SettingsFeedback } from "./settingsControls";
import { useContext, useId, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { POLICIES } from "../model/policies";
import { RevealedSetting, Select, settingDomId } from "./settingsControls";
import "./policies.css";

export function PoliciesSettings() {
  const locale = useLocale();
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  const [contactError, setContactError] = useState(false);
  const revealed = useContext(RevealedSetting);
  const [selection, setSelection] = useState(() => ({
    policy: POLICIES.find((policy) => policy.id === revealed) ?? POLICIES[0],
    revealed,
  }));
  if (selection.revealed !== revealed)
    setSelection({
      policy: POLICIES.find((policy) => policy.id === revealed) ?? selection.policy,
      revealed,
    });
  const activePolicy = selection.policy;
  const setActivePolicy = (policy: (typeof POLICIES)[number]) => setSelection({ policy, revealed });
  const readerId = useId();
  const language = languageOverride ?? (locale === "tr" ? "tr" : "en");
  const turkish = language === "tr";

  return (
    <div
      className="policies-settings"
      onClickCapture={(event) => {
        // The shared conversation renderer only opens HTTP links. Handle our
        // published contact address here without changing conversation behavior.
        const target = event.target instanceof Element ? event.target.closest("a") : null;
        if (target?.getAttribute("href") !== "mailto:info@bahadrhllyalcn.com") return;
        event.preventDefault();
        event.stopPropagation();
        setContactError(false);
        void openUrl("mailto:info@bahadrhllyalcn.com").catch(() => setContactError(true));
      }}
    >
      <aside className="policy-sidebar">
        <div
          className="policy-toolbar"
          data-setting-id="policy-language"
          id={settingDomId("policy-language")}
        >
          <span>{t("Policy language")}</span>
          <Select
            value={language}
            label={t("Policy language")}
            options={[
              { value: "tr", label: "Türkçe" },
              { value: "en", label: "English" },
            ]}
            onChange={setLanguageOverride}
          />
        </div>
        <nav
          className="policy-navigation"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t("Policy documents")}
        >
          {POLICIES.map((policy) => (
            <Button
              key={policy.id}
              id={settingDomId(policy.id)}
              data-setting-id={policy.id}
              variant="item"
              role="tab"
              aria-selected={activePolicy.id === policy.id}
              aria-controls={readerId}
              selected={activePolicy.id === policy.id}
              tabIndex={activePolicy.id === policy.id ? 0 : -1}
              onKeyDown={(event) => {
                const index = POLICIES.indexOf(policy);
                const next = {
                  ArrowDown: (index + 1) % POLICIES.length,
                  ArrowUp: (index + POLICIES.length - 1) % POLICIES.length,
                  Home: 0,
                  End: POLICIES.length - 1,
                }[event.key];
                if (next === undefined) return;
                event.preventDefault();
                setActivePolicy(POLICIES[next]);
                document.getElementById(settingDomId(POLICIES[next].id))?.focus();
              }}
              onClick={() => {
                setContactError(false);
                setActivePolicy(policy);
              }}
            >
              <span className="policy-link-title">{turkish ? policy.trTitle : policy.title}</span>
            </Button>
          ))}
        </nav>
        <details className="policy-reading-note">
          <summary>{t("About")}</summary>
          <h3>{t("Document language only; your app language and permissions stay unchanged.")}</h3>
          <p>
            {t(
              "Documents are bundled for offline reading. Other interface languages use the English text.",
            )}
          </p>
        </details>
      </aside>
      <section
        id={readerId}
        className="policy-reader"
        role="tabpanel"
        aria-labelledby={settingDomId(activePolicy.id)}
        tabIndex={0}
        key={activePolicy.id}
      >
        {contactError ? (
          <SettingsFeedback state="error">
            {t("Could not open your email app. Copy info@bahadrhllyalcn.com into your email app.")}
          </SettingsFeedback>
        ) : null}
        <article
          className="policy-document"
          lang={turkish && activePolicy.id !== "software-license" ? "tr" : "en"}
          aria-label={turkish ? activePolicy.trTitle : activePolicy.title}
        >
          <AgentMarkdown text={turkish ? activePolicy.tr : activePolicy.en} />
        </article>
      </section>
    </div>
  );
}
