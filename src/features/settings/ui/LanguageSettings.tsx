import { useState } from "react";
import {
  getLanguagePreference,
  getDomainLanguagePreference,
  setDomainLanguagePreference,
  type LanguageDomain,
  isLocale,
  LANGUAGES,
  setLanguagePreference,
  t,
  useLocale,
} from "../../../shared/i18n";
import { Group, Row, Select } from "./settingsControls";

export function LanguageSettings() {
  useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const change = async (value: string) => {
    if (value !== "system" && !isLocale(value)) return;
    setPending(true);
    setError(false);
    try {
      await setLanguagePreference(value);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Group
      title={t("Language")}
      description={t("Choose the language used for menus, settings and application controls.")}
    >
      <Row
        id="interface-language"
        label={t("Application language")}
        description={t("Changes apply immediately. Your conversations and drafts are preserved.")}
      >
        <Select
          label={t("Application language")}
          value={getLanguagePreference()}
          options={[{ value: "system", label: t("System language") }, ...LANGUAGES]}
          onChange={(value) => {
            void change(value);
          }}
          disabled={pending}
        />
        {error ? (
          <span role="alert" className="text-[12px] text-danger">
            {t("Could not load the language. Please try again.")}
          </span>
        ) : null}
      </Row>
      <DomainLanguageRow domain="git" />
      <DomainLanguageRow domain="technical" />
    </Group>
  );
}

function DomainLanguageRow({ domain }: { domain: LanguageDomain }) {
  useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const label = domain === "git" ? t("Git interface language") : t("Technical interface language");
  const change = async (value: string) => {
    if (value !== "app" && !isLocale(value)) return;
    setPending(true);
    setError(false);
    try {
      await setDomainLanguagePreference(domain, value);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Row
      id={`${domain}-language`}
      label={label}
      description={
        domain === "git"
          ? t("Git panels, branches, commits and diffs. English by default.")
          : t(
              "Terminal, file viewer and developer tool controls. Code and command output keep their original language.",
            )
      }
    >
      <Select
        label={label}
        value={getDomainLanguagePreference(domain)}
        options={[{ value: "app", label: t("Follow application language") }, ...LANGUAGES]}
        onChange={(value) => {
          void change(value);
        }}
        disabled={pending}
      />
      {error ? (
        <span role="alert" className="text-[12px] text-danger">
          {t("Could not load the language. Please try again.")}
        </span>
      ) : null}
    </Row>
  );
}
