import { t } from "../../../shared/i18n";
import type { SocialAccount } from "./social";

/** A saved account is not an active OAuth flow. */
export function accountConnectionStatus(
  account: SocialAccount,
  availability?: { configured: boolean },
  flowStatus?: string,
  now = Date.now(),
) {
  if (account.connected) {
    if (account.expiresAt && account.expiresAt < now) return t("Reconnection required");
    return account.accessApproved ? t("Connected") : t("Platform access approval required");
  }
  if (!availability) return t("Checking connection settings");
  if (!availability.configured) return t("Setup required");
  if (flowStatus === "waiting") return t("Waiting for permission in the browser");
  if (flowStatus === "selection") return t("Select the verified account");
  if (flowStatus === "failed") return t("Connection needs a retry");
  return t("Ready to connect");
}
