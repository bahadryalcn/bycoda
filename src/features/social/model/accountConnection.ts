import type { SocialAccount } from "./social";

/** A saved account is not an active OAuth flow. */
export function accountConnectionStatus(
  account: SocialAccount,
  availability?: { configured: boolean },
  flowStatus?: string,
  now = Date.now(),
) {
  if (account.connected) {
    if (account.expiresAt && account.expiresAt < now) return "Yeniden bağlantı gerekli";
    return account.accessApproved ? "Bağlı" : "Platform erişim onayı gerekli";
  }
  if (!availability) return "Bağlantı ayarları kontrol ediliyor";
  if (!availability.configured) return "Kurulum gerekli";
  if (flowStatus === "waiting") return "Tarayıcıda izin bekleniyor";
  if (flowStatus === "selection") return "Doğrulanan hesabı seçin";
  if (flowStatus === "failed") return "Bağlantı tekrar denenmeli";
  return "Bağlanmaya hazır";
}
