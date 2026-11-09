import { t, useLocale } from "../../../../shared/i18n";
import { EmailAccountForm } from "./EmailAccountForm";
import { EMAIL_PRESET_IDS, emailPresetLabel } from "./emailPresets";
import { MessagingAccountsCard } from "./MessagingAccountsCard";
import type { MessagingAccount } from "../../../messaging";

function describeEmail(account: MessagingAccount) {
  const preset = EMAIL_PRESET_IDS.find((id) => id === account.config.preset);
  const address =
    typeof account.config.address === "string" && account.config.address
      ? account.config.address
      : account.identity;
  return preset ? t("{p0} · {p1}", { p0: address, p1: emailPresetLabel(preset) }) : address;
}

/** Every connected mailbox; each account has its own servers and credentials. */
export function EmailAccountsSettings() {
  useLocale();
  return (
    <MessagingAccountsCard
      provider="email"
      emptyLabel={t("No email accounts connected yet.")}
      addLabel={t("Add account")}
      describe={describeEmail}
      Form={EmailAccountForm}
    />
  );
}
