import { t } from "../../../../shared/i18n";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import type { UnreadableAccount } from "./inboxTypes";
import { unreadableText } from "./inboxModel";
import "./inbox.css";

/**
 * Accounts the Host cannot read, as one compact warning row. One account names its reason inline;
 * several show a count and the reason for each. Never an empty list in its place.
 */
export function UnreadableNotice({
  accounts,
  names,
}: {
  accounts: UnreadableAccount[];
  names: Record<string, string>;
}) {
  if (accounts.length === 0) return null;
  const text = (account: UnreadableAccount) =>
    unreadableText(account, names[account.accountId] ?? "");
  if (accounts.length === 1)
    return (
      <div className="inbox-notices">
        <InlineMessage tone="warning">{text(accounts[0])}</InlineMessage>
      </div>
    );
  return (
    <div className="inbox-notices">
      <InlineMessage tone="warning">
        {t("Can't read messages on {p0} accounts.", { p0: accounts.length })}
      </InlineMessage>
      <ul className="inbox-notice-list">
        {accounts.map((account) => (
          <li key={account.accountId}>{text(account)}</li>
        ))}
      </ul>
    </div>
  );
}
