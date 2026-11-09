import { useId, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import type { UnreadableAccount } from "./inboxTypes";
import { unreadableText } from "./inboxModel";
import "./inbox.css";

/**
 * Accounts the Host cannot read, as one compact warning row. One account names its reason inline;
 * several collapse to a count with a disclosure. Never an empty list in its place.
 */
export function UnreadableNotice({
  accounts,
  names,
}: {
  accounts: UnreadableAccount[];
  names: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
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
      <InlineMessage
        tone="warning"
        action={
          <Button
            variant="link"
            layout="text"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t("Hide details") : t("Show details")}
          </Button>
        }
      >
        {t("Can't read messages on {p0} accounts.", { p0: accounts.length })}
      </InlineMessage>
      {open ? (
        <ul id={detailsId} className="inbox-notice-list">
          {accounts.map((account) => (
            <li key={account.accountId}>{text(account)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
