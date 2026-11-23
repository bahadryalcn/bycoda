import { t } from "../../../../shared/i18n";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import type { UnreadableAccount } from "./inboxTypes";
import { Text } from "../../../../shared/ui/Text";
import { unreadableText } from "./inboxModel";
import "./inbox.css";

/**
 * Accounts the Host cannot read, as one compact warning row. One account names its reason inline;
 * several show a count and the reason for each. Never an empty list in its place.
 */
export function UnreadableNotice({
  accounts,
  names,
  action,
}: {
  accounts: UnreadableAccount[];
  names: Record<string, string>;
  /** The one follow-up (open Accounts), rendered once on the notice. */
  action?: { label: string; onClick: () => void };
}) {
  if (accounts.length === 0) return null;
  const text = (account: UnreadableAccount) =>
    unreadableText(account, names[account.accountId] ?? "");
  if (accounts.length === 1)
    return (
      <div className="inbox-notices">
        <InlineMessage tone="warning" action={action}>
          {text(accounts[0])}
        </InlineMessage>
      </div>
    );
  return (
    <div className="inbox-notices">
      <InlineMessage tone="warning" action={action}>
        {t("Can't read messages on {p0} accounts.", { p0: accounts.length })}
      </InlineMessage>
      <Text as="ul" size="caption" tone="secondary" leading="inherit" className="inbox-notice-list">
        {accounts.map((account) => (
          <li key={account.accountId}>{text(account)}</li>
        ))}
      </Text>
    </div>
  );
}
