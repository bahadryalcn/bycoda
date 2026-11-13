import { useId, useState, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { ModalActions } from "../../../../shared/ui/Modal";

export type FormFooterOptions = {
  saving: boolean;
  /** Host or request failure of the last save. Shown first, the draft stays. */
  error?: string;
  /** Why Save is blocked. Shown beside the actions, never only on hover. */
  blockedReason?: string;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * The footer of an Audience form dialog: status text on the left (failure, else why Save is
 * blocked) and Cancel + Save on the right, so a long reason never stretches the button.
 * Spread the result onto the Modal.
 */
export function useFormFooter({
  saving,
  error,
  blockedReason,
  saveLabel,
  onSave,
  onCancel,
}: FormFooterOptions): { footerStart: ReactNode; footer: ReactNode } {
  const reasonId = useId();
  const showReason = !error && Boolean(blockedReason);
  return {
    footerStart: error ? (
      <InlineError>{error}</InlineError>
    ) : showReason ? (
      <InlineMessage tone="neutral" id={reasonId} live="off">
        {blockedReason}
      </InlineMessage>
    ) : undefined,
    footer: (
      <ModalActions>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={Boolean(blockedReason)}
          aria-describedby={showReason ? reasonId : undefined}
          onClick={onSave}
        >
          {saveLabel}
        </Button>
      </ModalActions>
    ),
  };
}

/** Which fields the person has left, so a required-field message shows beside the field only after they visited it. */
export function useTouched(): { touched: (key: string) => boolean; touch: (key: string) => void } {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  return {
    touched: (key) => seen.has(key),
    touch: (key) => setSeen((current) => (current.has(key) ? current : new Set(current).add(key))),
  };
}
