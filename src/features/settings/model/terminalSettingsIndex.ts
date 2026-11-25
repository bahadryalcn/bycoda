import { t } from "../../../shared/i18n/core";
import type { SettingsEntry } from "./settings";

/** Searchable Terminal controls; each `id` is a row's setting id in Settings → Terminal. */
export const TERMINAL_SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "terminal-default-profile",
    label: () => t("Default terminal profile"),
    keywords: "shell bash git bash powershell pwsh cmd wsl zsh default ! command",
  },
  {
    id: "terminal-code-result",
    label: () => t("Add result to chat when finished"),
    keywords: "code block run output result chat composer kod bloğu çalıştır çıktı sonuç sohbet",
  },
  {
    id: "terminal-available-shells",
    label: () => t("Advanced terminal settings"),
    keywords: "local available shells discovery advanced gelişmiş kabuk keşif",
  },
  {
    id: "host-shells",
    label: () => t("Default shell"),
    keywords: "remote server local sync host shell ssh uzak sunucu kabuk",
  },
].map((item) => ({
  id: item.id,
  section: "terminal" as const,
  get label() {
    return item.label();
  },
  keywords: item.keywords,
}));
