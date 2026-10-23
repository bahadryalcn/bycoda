import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { prettyCwd } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Alert } from "../../../shared/ui/Alert";

type Props = {
  /** The name both projects would show. */
  name: string;
  /** Location of the project being named, shown so it is clear which one it is. */
  path: string;
  /** Already applied to the project; cancelling keeps it. */
  suggested: string;
  /** Why a name cannot be used, or null. */
  validate: (name: string) => string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

/** Asks for another name for a project added under a name the rail already shows. */
export function ProjectNameConflictDialog({
  name,
  path,
  suggested,
  validate,
  onConfirm,
  onCancel,
}: Props) {
  useLocale();
  const [value, setValue] = useState(suggested);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <Modal
      size="sm"
      title={t("Rename project")}
      description={`${t('A project named "')}${name}${t('" already exists. Give this one a different name.')}`}
      onClose={onCancel}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const problem = validate(value);
          setError(problem);
          if (!problem) onConfirm(value.trim());
        }}
        className="flex flex-col gap-3 px-4 pt-2 pb-4"
      >
        <p className="truncate text-ui-micro leading-tight text-(--ui-text-muted)" title={path}>
          {prettyCwd(path)}
        </p>
        <TextField
          label={t("Project name")}
          hideLabel
          ref={input}
          aria-label={t("Project name")}
          aria-invalid={error ? true : undefined}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            onClick={onCancel}
            title={t('Keep "{p0}"', { p0: suggested })}
            variant="ghost"
          >
            {t("Cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {t("Rename")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
