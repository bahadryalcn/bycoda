import { SettingsFeedback } from "./settingsControls";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";
import { POLICIES } from "../model/policies";
import { RevealedSetting, Select, settingDomId } from "./settingsControls";
import "./policies.css";

export function PoliciesSettings() {
  const locale = useLocale();
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  // The mail failure belongs to the document and language it was raised for.
  const [contactErrorContext, setContactErrorContext] = useState<string | null>(null);
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
  const body = turkish ? activePolicy.tr : activePolicy.en;
  const context = `${activePolicy.id}:${language}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const reader = useRef<HTMLDivElement>(null);
  const mailAttempt = useRef(0);
  const contactError = contactErrorContext === context;
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]);
  useEffect(() => {
    mailAttempt.current += 1;
    return () => {
      mailAttempt.current += 1;
    };
  }, [context]);

  return (
    <div
      className="policies-settings"
      onClickCapture={(event) => {
        // The shared conversation renderer only opens HTTP links. Handle our
        // published contact address here without changing conversation behavior.
        const target = event.target instanceof Element ? event.target.closest("a") : null;
        if (target?.getAttribute("href") !== "mailto:info@bycoda.codes") return;
        event.preventDefault();
        event.stopPropagation();
        const origin = currentContext.current;
        const attempt = ++mailAttempt.current;
        setContactErrorContext(null);
        void openUrl("mailto:info@bycoda.codes").catch(() => {
          if (origin === currentContext.current && attempt === mailAttempt.current)
            setContactErrorContext(origin);
        });
      }}
    >
      <Tabs
        value={activePolicy.id}
        orientation="vertical"
        panels="shared"
        id={readerId}
        onValueChange={(id) => {
          setContactErrorContext(null);
          setActivePolicy(POLICIES.find((policy) => policy.id === id) ?? activePolicy);
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
              hideLabel
              value={language}
              label={t("Policy language")}
              options={[
                { value: "tr", label: "Türkçe" },
                { value: "en", label: "English" },
              ]}
              onChange={setLanguageOverride}
            />
          </div>
          <p className="policy-context">
            {t("Document language only; your app language and permissions stay unchanged.")}
          </p>
          <TabList className="policy-navigation" label={t("Policy documents")}>
            {POLICIES.map((policy) => (
              <Tab
                key={policy.id}
                value={policy.id}
                id={settingDomId(policy.id)}
                data-setting-id={policy.id}
              >
                <span className="policy-link-title">{turkish ? policy.trTitle : policy.title}</span>
              </Tab>
            ))}
          </TabList>
        </aside>
        <TabPanel
          ref={reader}
          className="policy-reader"
          labelledBy={settingDomId(activePolicy.id)}
          key={activePolicy.id}
        >
          <div className="policy-reader-context">
            <p>
              {t(
                "Documents are bundled for offline reading. Other interface languages use the English text.",
              )}
            </p>
            {turkish && activePolicy.id === "software-license" ? (
              <p>{t("This license is shown in its original English text.")}</p>
            ) : null}
            {headings.length > 1 ? (
              <Select
                hideLabel
                label={t("Document sections")}
                value=""
                options={[
                  { value: "", label: t("Jump to section") },
                  ...headings.map((label, index) => ({ value: String(index), label })),
                ]}
                onChange={(value) => {
                  const heading =
                    reader.current?.querySelectorAll<HTMLElement>(".policy-document h2")[
                      Number(value)
                    ];
                  if (!heading || value === "") return;
                  heading.tabIndex = -1;
                  heading.scrollIntoView({ block: "start" });
                  heading.focus({ preventScroll: true });
                }}
              />
            ) : null}
          </div>
          {contactError ? (
            <SettingsFeedback state="error">
              {t("Could not open your email app. Copy info@bycoda.codes into your email app.")}
            </SettingsFeedback>
          ) : null}
          <article
            className="policy-document"
            lang={turkish && activePolicy.id !== "software-license" ? "tr" : "en"}
            aria-label={turkish ? activePolicy.trTitle : activePolicy.title}
          >
            <AgentMarkdown text={body} />
          </article>
        </TabPanel>
      </Tabs>
    </div>
  );
}
