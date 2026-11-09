import type {
  SecurityActivityItem,
  SecurityActivityKind,
  SignInClient,
  SignInMethod,
} from "@bycoda/account-contracts";
import { getLocale, t } from "../../../shared/i18n";

/** What happened, as a sentence title for the security timeline. */
export function securityEventTitle(kind: SecurityActivityKind): string {
  switch (kind) {
    case "session_started":
      return t("Signed in");
    case "device_registered":
      return t("New device added");
    case "device_revoked":
      return t("Device signed out");
    case "account_deactivated":
      return t("Account deactivated");
    case "account_reactivated":
      return t("Account reactivated");
    case "export_requested":
      return t("Data export requested");
    case "deletion_requested":
      return t("Account deletion requested");
    case "deletion_cancelled":
      return t("Account deletion cancelled");
  }
}

export function signInClientLabel(client: SignInClient): string {
  switch (client) {
    case "desktop":
      return t("Desktop app");
    case "mobile":
      return t("Mobile app");
    case "portal":
      return t("Web account page");
    case "admin":
      return t("bycoda support");
  }
}

export function signInMethodLabel(method: SignInMethod): string {
  switch (method) {
    case "google":
      return "Google";
    case "facebook":
      return "Facebook";
    case "apple":
      return "Apple";
    case "github":
      return "GitHub";
    case "email_code":
      return t("E-mail code");
  }
}

/** Localized country name for an ISO 3166 code; the code itself when the runtime has no name. */
export function countryName(code: string, locale: string = getLocale()): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Device, app and country of one event, joined for the timeline's context line. */
export function securityEventMeta(item: SecurityActivityItem, locale?: string): string {
  return [
    item.device?.name,
    item.client ? signInClientLabel(item.client) : null,
    item.country ? countryName(item.country, locale) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Events that remove access or data read as danger; the title still says what happened. */
export function securityEventTone(kind: SecurityActivityKind): "neutral" | "danger" {
  return kind === "deletion_requested" || kind === "account_deactivated" ? "danger" : "neutral";
}
