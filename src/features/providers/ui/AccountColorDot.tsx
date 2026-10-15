import { providerAccountColorValue, type ProviderAccount } from "../model/providerAccounts";

/** Small dot in the account's colour, so accounts read apart at a glance. */
export function AccountColorDot({
  account,
  className = "size-2",
}: {
  account: Pick<ProviderAccount, "id" | "provider" | "color">;
  className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-full ${className}`}
      style={{ background: providerAccountColorValue(account) }}
      data-account-color={account.color ?? "auto"}
      aria-hidden
    />
  );
}
