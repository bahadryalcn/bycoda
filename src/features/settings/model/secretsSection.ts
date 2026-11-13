import { t } from "../../../shared/i18n/core";
import type { SettingsSection } from "./settings";

/** Credentials agents asked for in chat, saved per project until the owner removes them. */
export const SECRETS_SECTION: SettingsSection = {
  id: "secrets",
  group: "tools",
  get label() {
    return t("Secrets");
  },
  get description() {
    return t("Credentials agents asked you for. Remove them here at any time.");
  },
  keywords: "secret credential token password api key agent vault saved remove gizli anahtar",
};
