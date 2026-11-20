import { useFormat } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";

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
