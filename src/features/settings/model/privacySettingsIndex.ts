import { t } from "../../../shared/i18n/core";
import type { SettingsEntry } from "./settings";
import { PERMISSION_IDS, permissionInfo } from "../../permissions/public/metadata";

/** Searchable Privacy controls; each `id` is a row's setting id in Settings → Privacy. */
export const PRIVACY_SETTINGS_INDEX: SettingsEntry[] = [
  ...PERMISSION_IDS.map((id): SettingsEntry => ({
    id: `permission-${id}`,
    section: "permissions",
    get label() {
      return permissionInfo(id).label;
    },
    get keywords() {
      return `permissions system access privacy ${id} izin erişim ${permissionInfo(id).usedBy}`;
    },
  })),
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
  {
    id: "anonymous-token-totals",
    section: "groupLock",
    get label() {
      return t("Share anonymous token totals");
    },
    keywords: "privacy anonymous usage telemetry analytics API cost USD maliyet izin",
  },
  {
    id: "activity-sharing",
    section: "groupLock",
    get label() {
      return t("Share active time");
    },
    keywords: "privacy data sharing activity sync active minutes permission süre izin",
  },
  {
    id: "data-sharing-receipts",
    section: "groupLock",
    get label() {
      return t("Data sharing receipts");
    },
    keywords: "privacy data sharing notification sent destination gönderim bildirim",
  },
];
