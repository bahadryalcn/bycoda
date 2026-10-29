import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";

type Props = {
  title: string;
  description: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  error?: string | null;
  /** Starting text, for renames. */
  initialValue?: string;
  /** A second required field below the name, e.g. a remote's URL. */
  extra?: { label: string; placeholder: string };
  onSubmit: (name: string, extra: string) => void;
  onCancel: () => void;
};

/** Asks for a name (a branch, tag, or remote), and optionally one more value. */
export function RefNameDialog({
  title,
  description,
  label,
  placeholder,
  submitLabel,
  busy,
  error,
  initialValue = "",
  extra,
  onSubmit,
  onCancel,
}: Props) {
  useLocale();
  const [name, setName] = useState(initialValue);
  const [extraValue, setExtraValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const trimmedExtra = extraValue.trim();
  const complete = trimmed !== "" && (!extra || trimmedExtra !== "");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || busy) return;
    onSubmit(trimmed, trimmedExtra);
  };

  return (
    <Modal
      languageDomain="git"
      title={title}
      description={description}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        {/* The failure message belongs to the name field, which takes focus when it appears. */}
        <TextField
          label={label}
          ref={input}
          type="text"
          value={name}
          placeholder={placeholder}
          error={error || undefined}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        {extra ? (
          <TextField
            label={extra.label}
            type="text"
            value={extraValue}
            placeholder={extra.placeholder}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={busy}
            onChange={(event) => setExtraValue(event.target.value)}
          />
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            motion="none"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {t("Cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            motion="none"
            type="submit"
            disabled={!complete || busy}
            className="inline-flex items-center gap-1.5"
          >
            {busy ? <Loader className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
