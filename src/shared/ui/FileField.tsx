import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Field } from "./Field";
import styles from "./FileField.module.css";

export interface FileFieldProps {
  label: string;
  /** Keep the label for assistive tech only; the field then needs its own visible context. */
  hideLabel?: boolean;
  description?: string;
  error?: string;
  /** Native `accept` filter for the picker. Dropped files are passed through unfiltered. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Short text inside the drop area, for example the accepted formats. */
  hint?: ReactNode;
  /** Label of the picker button. Default: "Choose file…" / "Choose files…". */
  buttonLabel?: string;
  /** The picked or dropped files. Never called with an empty list. */
  onFiles: (files: File[]) => void;
  className?: string;
}

/**
 * Pick or drop local files: a translated button and a drop area instead of the browser's own
 * file control (whose text follows the operating system language). The same file can be picked
 * again after a failure. The caller owns validation, upload, progress and the list of attachments.
 * @group fields
 * @use Attaching images, documents or an import file from the user's computer inside a form.
 * @avoid Choosing a path on the Host or a folder: the native path picker dialog. A text input with `type="file"`: never.
 * @example
 * <FileField
 *   label={t("Images or one video")}
 *   hint={t("JPEG or PNG images, or one MP4 video.")}
 *   accept="image/jpeg,image/png,video/mp4"
 *   multiple
 *   error={error}
 *   onFiles={attach}
 * />
 */
export function FileField({
  label,
  hideLabel,
  description,
  error,
  accept,
  multiple = false,
  disabled = false,
  hint,
  buttonLabel,
  onFiles,
  className,
}: FileFieldProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
      className={className}
    >
      {(control) => (
        <div
          className={styles.zone}
          data-dragging={dragging ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
          data-invalid={error ? "" : undefined}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          {hint ? <span className={styles.hint}>{hint}</span> : null}
          <Button
            {...control}
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            {buttonLabel ?? (multiple ? t("Choose files…") : t("Choose file…"))}
          </Button>
          <input
            ref={input}
            className={styles.input}
            type="file"
            tabIndex={-1}
            aria-hidden="true"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Clear the native value so the same file can be picked again.
              event.target.value = "";
              if (files.length) onFiles(files);
            }}
          />
        </div>
      )}
    </Field>
  );
}
