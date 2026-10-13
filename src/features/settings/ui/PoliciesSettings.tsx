import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocale } from "../../../shared/i18n";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { POLICIES } from "../model/policies";
import { Group, Select } from "./settingsControls";
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
        title={turkish ? "Politika dili" : "Policy language"}
        description={
          turkish
            ? "Metinler uygulamaya dahildir; çevrimdışı okunabilir. Diğer arayüz dillerinde İngilizce metin gösterilir."
            : "Documents are bundled for offline reading. Other interface languages use the English text."
        }
        action={
          <Select
            value={language}
            label={turkish ? "Politika dili" : "Policy language"}
            options={[
              { value: "tr", label: "Türkçe" },
              { value: "en", label: "English" },
            ]}
            onChange={setLanguageOverride}
          />
        }
      >
        <p className="policy-intro">
          {turkish
            ? "Geliştirici kullanıcıları takip etmez veya çalışma alanı verilerini toplamaz. Yerel kayıtlar ve bağladığınız servislerle veri paylaşımı aşağıda açıklanır. İletişim: info@bahadrhllyalcn.com."
            : "The maintainer does not track users or collect workspace data. Local storage and connected-service data sharing are explained below. Contact: info@bahadrhllyalcn.com."}
        </p>
      </Group>
      {contactError ? (
        <p role="alert" className="policy-intro">
          {turkish
            ? "E-posta uygulaması açılamadı. info@bahadrhllyalcn.com adresini kopyalayıp e-posta uygulamanızda kullanın."
            : "Could not open your email app. Copy info@bahadrhllyalcn.com into your email app."}
        </p>
      ) : null}
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
    </div>
  );
}
