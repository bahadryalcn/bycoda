import { UsagePage } from "../../usage/public/UsagePage";

/** Provider usage settings; the personal Today view lives on the Account page. */
export function UsageSettingsPage({ limitsOnly = false }: { limitsOnly?: boolean }) {
  return <UsagePage limitsOnly={limitsOnly} />;
}
