import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useAccount } from "../hooks/useAccount";
import { AccountAvatar } from "./AccountAvatar";

/**
 * Account entry at the bottom of the Settings rail: avatar and name when signed in, "Sign in"
 * for a guest. It only selects the Account section; signing in happens there.
 */
export function AccountRailRow({
  active,
  onSelect,
  id,
}: {
  active: boolean;
  onSelect: () => void;
  id?: string;
}) {
  useLocale();
  const { state } = useAccount();
  const user = state.phase === "signed-in" ? state.context.user : null;
  const label = user ? user.displayName || user.email : t("Sign in");
  return (
    <Button
      id={id}
      selected={active}
      variant="item"
      motion="none"
      type="button"
      onClick={onSelect}
      tooltip={user ? user.email : undefined}
      tooltipWhen="overflow"
      tooltipSide="right"
      aria-label={user ? t("Account: {p0}", { p0: label }) : t("Account: sign in")}
      aria-current={active ? "true" : undefined}
      className="flex w-full items-center gap-2 @max-[140px]/rail:justify-center"
    >
      <AccountAvatar user={user} />
      <Text
        size="body"
        tone="inherit"
        weight="medium"
        leading="tight"
        truncate
        className="min-w-0 flex-1 text-start @max-[140px]/rail:hidden"
      >
        {label}
      </Text>
    </Button>
  );
}
