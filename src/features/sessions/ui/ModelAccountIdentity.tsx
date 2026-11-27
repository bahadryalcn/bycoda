import { useFormat } from "../../../shared/i18n";
import type { HTMLAttributes } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { Text } from "../../../shared/ui/Text";

export type ModelAccountIdentity = {
  accountNumber?: number;
  accountColor?: string;
  accountLabel?: string;
};

export function ModelAccountNumber({
  account,
  className,
}: {
  account?: ModelAccountIdentity;
  className?: string;
}) {
  const { formatNumber } = useFormat();
  if (account?.accountNumber === undefined) return null;
  return (
    <Badge
      size="xs"
      leading="none"
      identityColor={account.accountColor}
      className={className}
      data-model-account-number
      aria-hidden
    >
      {formatNumber(account.accountNumber)}
    </Badge>
  );
}

/**
 * The account a model runs on, as everywhere a model is listed: its number badge, then its label
 * as plain text. The caller sets the type size and tone around it.
 */
export function ModelAccountLabel({
  account,
  className,
  ...rest
}: {
  account: ModelAccountIdentity & { accountLabel: string };
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children">) {
  return (
    <span {...rest} className={`inline-flex min-w-0 items-center gap-1 ${className ?? ""}`.trim()}>
      <ModelAccountNumber account={account} />
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {account.accountLabel}
      </Text>
    </span>
  );
}
