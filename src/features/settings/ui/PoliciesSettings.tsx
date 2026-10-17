import { Alert } from "../../../shared/ui/Alert";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { POLICIES } from "../model/policies";
import { AdvancedSettings, Group, Select } from "./settingsControls";
import "./policies.css";

export function PoliciesSettings() {
  const locale = useLocale();
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  const [contactError, setContactError] = useState(false);
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
      <Group
        id="policy-language"
        title={t("Policy language")}
        description={t(
          "Documents are bundled for offline reading. Other interface languages use the English text.",
        )}
        scope={t("Document language only; your app language and permissions stay unchanged.")}
        action={
          <Select
            value={language}
            label={t("Policy language")}
            options={[
              { value: "tr", label: "Türkçe" },
              { value: "en", label: "English" },
            ]}
            onChange={setLanguageOverride}
          />
        }
      >
        <p className="policy-intro">
          {t(
            "The maintainer does not track users or collect workspace data. Local storage and connected-service data sharing are explained below. Contact: info@bahadrhllyalcn.com.",
          )}
        </p>
      </Group>
      {contactError ? (
        <Alert tone="danger" role="alert">
          {t("Could not open your email app. Copy info@bahadrhllyalcn.com into your email app.")}
        </Alert>
      ) : null}
      <nav className="policy-navigation" aria-label={t("Policy documents")}>
        {POLICIES.map((policy) => (
          <a
            key={policy.id}
            href={`#setting-${policy.id}`}
            onClick={(event) => {
              event.preventDefault();
              const target = document.getElementById(`setting-${policy.id}`);
              target?.closest("details")?.setAttribute("open", "");
              target?.scrollIntoView({ block: "start" });
              target?.focus({ preventScroll: true });
            }}
          >
            {turkish ? policy.trTitle : policy.title}
          </a>
        ))}
      </nav>
      <AdvancedSettings
        title={t("Full policy documents")}
        defaultOpen
        settingIds={POLICIES.map((policy) => policy.id)}
      >
        {POLICIES.map((policy) => (
          <Group
            key={policy.id}
            id={policy.id}
            title={turkish ? policy.trTitle : policy.title}
            layout="full"
          >
            <article
              className="policy-document"
              lang={turkish && policy.id !== "software-license" ? "tr" : "en"}
              aria-label={turkish ? policy.trTitle : policy.title}
            >
              <AgentMarkdown text={turkish ? policy.tr : policy.en} />
            </article>
          </Group>
        ))}
      </AdvancedSettings>
    </div>
  );
}
