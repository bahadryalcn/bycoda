import { useId, useRef, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Popover } from "../../../../shared/ui/Popover";
import { TriangleAlert } from "../../../../shared/ui/icons";
import { MicrophoneRecoveryAction } from "../MicrophoneRecoveryAction";

/** Errors whose text is already the owner's next step; every other error is a technical detail. */
export function isActionableVoiceError(error: string | undefined) {
  return (
    error === t("Conversation was not saved. Retry.") ||
    error ===
      t("Current computer presence could not be verified. Mark yourself here before talking.")
  );
}

/** What the header mark is called: the next step itself, or the generic attention line. */
export function voiceErrorTitle(error: string) {
  return isActionableVoiceError(error) ? error : t("Voice needs attention");
}

/**
 * Header mark for a voice error. It carries `data-voice-error`, which tints the whole card, and
 * opens the message with a Dismiss action; dismissing clears the error and the card returns to
 * normal. Mount it only while there is an error, so a later error starts closed.
 */
export function VoiceErrorNotice({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const title = voiceErrorTitle(error);
  return (
    <>
      <Button
        ref={anchor}
        iconOnly
        variant="ghost"
        tone="danger"
        data-voice-error=""
        label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <TriangleAlert className="icon-sm" />
      </Button>
      {open ? (
        <Popover
          id={contentId}
          anchor={anchor}
          width={300}
          kind="dialog"
          aria-label={title}
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="flex flex-col gap-2 p-3 text-ui-caption"
        >
          {title === error ? null : <p className="font-medium">{title}</p>}
          <p className="break-words text-(--ui-text-secondary) select-text">{error}</p>
          <MicrophoneRecoveryAction message={error} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={onDismiss}>
              {t("Dismiss")}
            </Button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
