import { t } from "../../../shared/i18n/core";
import type { SettingsSection } from "./settings";

/** The individual account page: sign-in, devices, active time and privacy choices. */
export const ACCOUNT_SECTION: SettingsSection = {
  id: "account",
  group: "account",
  get label() {
    return t("Account");
  },
  get description() {
    return t("Sign in, manage your devices and see your activity.");
  },
  keywords:
    "account sign in login devices active time today week activity run time cost project summary profile privacy statistics hesap giriş bugün etkinlik",
};
