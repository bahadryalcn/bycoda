import type { ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { InlineError } from "./InlineError";
import { ModalActions } from "./Modal";

export type FormFooterOptions = {
  saving: boolean;
  /** Host or request failure of the last save. Shown first, the draft stays. */
  error?: string;
  /** Why the primary action is blocked. Shown once beside the actions; only while a save failure takes that space does it move to the button's `disabledReason`. */
  blockedReason?: string;
  /** Label of the primary action. */
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * The footer of a form dialog whose own component holds the form state: status text at the start
 * edge (failure, else why the primary is blocked), Cancel + primary at the end, so a long reason
 * never stretches the button. Spread the result onto the Modal or Sheet. The blocked reason has one
 * visible owner (`ModalActions reason`); the button repeats it only while a failure hides it.
 * @group overlay
 * @use A form Modal whose primary action depends on validation and needs a visible blocked reason.
 * @avoid The same reason in a tooltip and in the footer, or hint paragraphs in the dialog body; a footer with several primaries: ModalActions with `reason`.
 */
export function useFormFooter({
  saving,
  error,
  blockedReason,
  saveLabel,
  onSave,
  onCancel,
}: FormFooterOptions): { footer: ReactNode } {
  const t = useT();
  // One visible owner: the failure of the last save wins the footer text, else the blocked reason.
  // While a failure holds that space, the blocker stays reachable on the disabled button instead.
  const visibleReason = error ? undefined : blockedReason;
  const hiddenReason = error ? blockedReason : undefined;
  return {
    footer: (
      <ModalActions
        start={error ? <InlineError details={error} /> : undefined}
        reason={visibleReason}
      >
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={Boolean(blockedReason)}
          disabledReason={hiddenReason}
          onClick={onSave}
        >
          {saveLabel}
        </Button>
      </ModalActions>
    ),
  };
}
