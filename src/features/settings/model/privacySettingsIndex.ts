import { t } from "../../../shared/i18n/core";
import type { SettingsEntry } from "./settings";

/** Searchable Privacy controls; each `id` is a row's setting id in Settings → Privacy. */
export const PRIVACY_SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "mask-emails",
    section: "groupLock",
    get label() {
      return t("Mask account emails");
    },
    keywords: "email privacy blur hide screenshot account",
  },
  {
    id: "anonymous-statistics",
    section: "groupLock",
    get label() {
      return t("Share anonymous usage statistics");
    },
    keywords: "privacy anonymous statistics usage telemetry analytics install id stats share",
  },
];
