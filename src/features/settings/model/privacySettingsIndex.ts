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
];
