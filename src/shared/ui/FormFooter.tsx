import type { ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { InlineError } from "./InlineError";
import { ModalActions } from "./Modal";

export type FormFooterOptions = {
  saving: boolean;
  /** Host or request failure of the last save. Shown first, the draft stays. */
  error?: string;
  /** Why the primary action is blocked. Shown beside the actions and as the button's `disabledReason`, never only on hover. */
  blockedReason?: string;
  /** Label of the primary action. */
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * The footer of a form dialog whose own component holds the form state: status text at the start
 * edge (failure, else why the primary is blocked), Cancel + primary at the end, so a long reason
 * never stretches the button. Spread the result onto the Modal or Sheet. The same visible reason
 * is `ModalActions reason` plus `Button disabledReason`, for footers with another action layout.
 * @group overlay
 * @use A form Modal whose primary action depends on validation and needs a visible blocked reason.
 * @avoid A reason only in a tooltip, or hint paragraphs in the dialog body; a footer with several primaries: ModalActions with `reason`.
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
  const reason = error ? undefined : blockedReason;
  return {
    footer: (
      <ModalActions start={error ? <InlineError>{error}</InlineError> : undefined} reason={reason}>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={Boolean(blockedReason)}
          disabledReason={reason}
          onClick={onSave}
        >
          {saveLabel}
        </Button>
      </ModalActions>
    ),
  };
}
