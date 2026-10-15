import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LanguageSettings } from "../../src/features/settings/ui/LanguageSettings";
import { SettingsNav } from "../../src/app/shell/SettingsRail";
import { SettingsSearch } from "../../src/features/settings/ui/SettingsSearch";
import { languageReady, t, useLocale } from "../../src/shared/i18n";
import { t as gitText, useLocale as useGitLocale } from "../../src/shared/i18n/git";
import {
  t as technicalText,
  useLocale as useTechnicalLocale,
} from "../../src/shared/i18n/technical";
import "../../src/styles/index.css";

function Fixture() {
  useLocale();
  useGitLocale();
  useTechnicalLocale();
  const [draft, setDraft] = useState("");
  return (
    <div className="flex min-h-screen bg-sidebar text-content">
      <aside className="hidden w-48 shrink-0 border-r border-content/10 sm:flex sm:flex-col">
        <SettingsNav section="general" onSelect={() => {}} onClose={() => {}} />
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl">{t("Settings")}</h1>
          <SettingsSearch onReveal={() => {}} />
        </div>
        <LanguageSettings />
        <p data-testid="git-control">{gitText("Cancel")}</p>
        <p data-testid="technical-control">{technicalText("Cancel")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button>{t("New session")}</button>
          <button>{t("Cancel")}</button>
          <button>{t("Send")}</button>
        </div>
        <textarea
          data-testid="draft"
          aria-label="Draft"
          className="mt-6 w-full rounded border border-content/20 bg-content/5 p-3"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="mt-3 text-sm text-content/60">
          {t("Changes apply immediately. Your conversations and drafts are preserved.")}
        </p>
      </main>
    </div>
  );
}
void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
