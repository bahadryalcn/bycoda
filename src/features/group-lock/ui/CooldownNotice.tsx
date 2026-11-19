import type { ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";

/**
 * The notice shown while a wrong-password cool-down runs. Screen readers hear one
 * fixed sentence when it appears; the remaining time changes every second, so it
 * stays visible but outside any live region.
 */
export function CooldownNotice({ id, children }: { id: string; children: ReactNode }) {
  return (
    <>
      <LiveText
        className="sr-only"
        mode="assertive"
        text={t("Too many wrong passwords. Try again later.")}
      />
      <InlineError id={id} live="off">
        {children}
      </InlineError>
    </>
  );
}
