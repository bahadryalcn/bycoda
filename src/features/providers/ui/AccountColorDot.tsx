import type { CSSProperties } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
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
      {...surfaceAttributes({ radius: "pill", variant: "user-color" }, `shrink-0 ${className}`)}
      style={{ "--surface-user-color": providerAccountColorValue(account) } as CSSProperties}
      data-account-color={account.color ?? "auto"}
      aria-hidden
    />
  );
}
