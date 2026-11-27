import { t } from "../../../shared/i18n";

/**
 * The one statistics disclosure: what the daily signal contains, what never leaves the computer,
 * and that it stays off until the user says yes. Onboarding, the consent
 * toast and Settings all read this string, so its wording and translations exist once.
 */
export function statsDisclosure(): string {
  return t(
    "Once a day bycoda can send a small signal: a random install id, the app version, the operating system, the release channel and the date. Never your sessions, prompts, code, file names, projects or account details. It is off unless you say yes. You can change it any time in Settings → Privacy.",
  );
}
