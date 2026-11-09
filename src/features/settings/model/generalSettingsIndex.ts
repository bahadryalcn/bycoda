import { t } from "../../../shared/i18n/core";
import type { SettingsEntry } from "./settings";

/** Searchable General controls; each `id` is a row's setting id in Settings → General. */
export const GENERAL_SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "performance-trace",
    section: "general",
    get label() {
      return t("Performance trace");
    },
    keywords:
      "diagnostics performance trace freeze lag slow startup long task debug performans tanılama izleme donma",
  },
  {
    id: "performance-trace-data",
    section: "general",
    get label() {
      return t("Trace data");
    },
    keywords: "copy clear export json diagnostics performance trace izleme verisi kopyala temizle",
  },
  {
    id: "session-folder",
    section: "general",
    get label() {
      return t("Folder for sessions without a project");
    },
    keywords:
      "no project projectless default folder path directory location chat sessions projesiz klasör varsayılan konum",
  },
];
