import { OverflowTooltip } from "./Tooltip";
import { useState } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { optionalTextAttributes, Text } from "./Text";
import { useMaskEmails } from "../../features/settings/model/displayPrefs";

/**
 * Account email that honours the "mask emails" display setting: blurred with a reveal/hide toggle when masking is on,
 * truncating text with an overflow tooltip when off. `wrap` keeps full values readable in account details.
 * Reveal resets when masking is turned back on.
 * @group text
 * @use Any account or user email shown in settings, provider or account rows.
 * @avoid Other secrets: PasswordField. Emails in editable fields or copy that must stay readable. Readable public copy without masking: Text.
 */
export function PrivateEmail({ email, wrap = false }: { email: string; wrap?: boolean }) {
  const t = useT();
  const masked = useMaskEmails();
  const [revealed, setRevealed] = useState(false);
  const [wasMasked, setWasMasked] = useState(masked);
  if (masked !== wasMasked) {
    // Turning masking back on hides an email revealed before it was turned off.
    setWasMasked(masked);
    setRevealed(false);
  }
  if (!masked) {
    if (wrap)
      return (
        <Text size="inherit" tone="inherit" wrap="anywhere">
          {email}
        </Text>
      );
    return (
      <OverflowTooltip label={email}>
        <span className="min-w-0 truncate">{email}</span>
      </OverflowTooltip>
    );
  }
  const action = revealed ? t("Hide email") : t("Reveal email");

  return (
    <Button
      variant="link"
      layout={wrap ? "text" : undefined}
      motion="none"
      type="button"
      aria-label={action}
      aria-pressed={revealed}
      title={action}
      className={
        wrap
          ? "pointer-events-auto relative min-w-0"
          : "pointer-events-auto relative min-w-0 truncate text-left"
      }
      onClick={(event) => {
        event.stopPropagation();
        setRevealed((value) => !value);
      }}
    >
      <span
        aria-hidden={!revealed}
        {...optionalTextAttributes(
          wrap ? { wrap: "anywhere" } : {},
          revealed ? undefined : "select-none blur-[5px]",
        )}
      >
        {email}
      </span>
    </Button>
  );
}
