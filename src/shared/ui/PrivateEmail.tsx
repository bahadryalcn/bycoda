import { OverflowTooltip } from "./Tooltip";
import { useState } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { useMaskEmails } from "../../features/settings/model/displayPrefs";

/**
 * Account email that honours the "mask emails" display setting: blurred with a reveal/hide toggle when masking is on,
 * truncating text with an overflow tooltip when off. Reveal resets when masking is turned back on.
 * @group text
 * @use Any account or user email shown in settings, provider or account rows.
 * @avoid Other secrets: PasswordField. Emails in editable fields or copy that must stay readable. Readable public copy without masking: Text.
 */
export function PrivateEmail({ email }: { email: string }) {
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
      motion="none"
      type="button"
      aria-label={action}
      aria-pressed={revealed}
      title={action}
      className="pointer-events-auto relative min-w-0 truncate text-left"
      onClick={(event) => {
        event.stopPropagation();
        setRevealed((value) => !value);
      }}
    >
      <span aria-hidden={!revealed} className={revealed ? undefined : "select-none blur-[5px]"}>
        {email}
      </span>
    </Button>
  );
}
