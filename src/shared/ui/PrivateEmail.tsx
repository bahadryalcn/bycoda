import { useState } from "react";
import { t, useLocale } from "../i18n";
import { Button } from "./Button";
import { useMaskEmails } from "../../features/settings/model/displayPrefs";

/**
 * With email masking on, keep account emails private in screenshots until
 * explicitly revealed; otherwise show them as plain text.
 */
export function PrivateEmail({ email }: { email: string }) {
  useLocale();
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
      <span className="min-w-0 truncate" title={email}>
        {email}
      </span>
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
