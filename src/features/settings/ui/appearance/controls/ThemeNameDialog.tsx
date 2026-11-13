import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { isImeComposition } from "../../../../../shared/lib/keyboard";
import { Button } from "../../../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../../../shared/ui/Modal";
import { TextField } from "../../../../../shared/ui/TextField";
import { SAVED_THEME_NAME_MAX, normalizeThemeName } from "../../../model/savedThemes";

/** Asks for a saved theme's name; Enter confirms, and an empty name cannot be confirmed. */
export function ThemeNameDialog({
  title,
  confirmLabel,
  initialName = "",
  description,
  onSubmit,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  initialName?: string;
  description?: string;
  /** Receives the cleaned name; a rejection keeps the dialog open with the error. */
  onSubmit: (name: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = normalizeThemeName(name);
  const submit = async () => {
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clean);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };
  // submit() reports its own failures in the dialog; the handler only keeps an unexpected one visible.
  const run = () => {
    submit().catch((cause: unknown) => console.error(cause));
  };
  return (
    <Modal
      size="sm"
      title={title}
      description={description}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel={t("Saving…")}
            disabled={!clean}
            onClick={run}
          >
            {confirmLabel}
          </Button>
        </ModalActions>
      }
    >
      <TextField
        label={t("Theme name")}
        value={name}
        maxLength={SAVED_THEME_NAME_MAX}
        autoFocus
        disabled={busy}
        error={error ?? undefined}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) {
            event.preventDefault();
            run();
          }
        }}
      />
    </Modal>
  );
}
