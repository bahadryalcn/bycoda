import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Modal } from "../../../shared/ui/Modal";
import type { GitBranchInfo } from "../../../platform/tauri/fs";

type Props = {
  busy: boolean;
  error?: string | null;
  initialName?: string;
  branches?: GitBranchInfo[];
  initialReference?: string;
  onCreate: (name: string, reference?: string) => void;
  onCancel: () => void;
};

export function CreateBranchDialog({
  busy,
  error,
  initialName = "",
  branches,
  initialReference,
  onCreate,
  onCancel,
}: Props) {
  useLocale();
  const [name, setName] = useState(initialName);
  const references = branches?.map((branch) =>
    branch.remote ? `${branch.remote}/${branch.name}` : branch.name,
  );
  const [reference, setReference] = useState(() =>
    references?.includes(initialReference ?? "") ? initialReference! : (references?.[0] ?? ""),
  );
  const input = useRef<HTMLInputElement>(null);
  const referencesId = useId();
  const trimmed = name.trim();
  const trimmedReference = reference.trim();

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || busy || (branches && !trimmedReference)) return;
    onCreate(trimmed, branches ? trimmedReference : undefined);
  };

  return (
    <Modal
      languageDomain="git"
      title={t(branches ? "New branch from…" : "New branch")}
      description={t("Create and check out a branch in this project.")}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        {branches ? (
          <>
            <TextField
              label={t("Base branch")}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              aria-label={t("Base branch")}
              list={referencesId}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
            />
            <datalist id={referencesId}>
              {references?.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </>
        ) : null}
        <TextField
          label={t("Branch name")}
          ref={input}
          type="text"
          value={name}
          placeholder={t("feature/my-branch")}
          aria-label={t("Branch name")}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />

        {error ? (
          <p role="alert" className="text-[11px] leading-4 text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" disabled={busy} onClick={onCancel} variant="ghost">
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!trimmed || busy || Boolean(branches && !trimmedReference)}
            loading={busy}
          >
            {t("Create branch")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
