import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
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
  const formId = useId();
  const trimmed = name.trim();
  const trimmedReference = reference.trim();

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  const blockedReason = !trimmed
    ? t("Enter a name.")
    : branches && !trimmedReference
      ? t("Choose a base branch.")
      : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || busy || (branches && !trimmedReference)) return;
    onCreate(trimmed, branches ? trimmedReference : undefined);
  };

  return (
    <Modal
      languageDomain="git"
      title={t(branches ? "New branch from…" : "New branch")}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
      footer={
        <ModalActions reason={blockedReason}>
          <Button type="button" disabled={busy} onClick={onCancel} variant="ghost">
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || Boolean(blockedReason)}
            loading={busy}
          >
            {t("Create")}
          </Button>
        </ModalActions>
      }
    >
      <form id={formId} className="flex flex-col gap-4" onSubmit={submit}>
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
        {branches ? (
          <>
            <TextField
              label={t("Base branch")}
              value={reference}
              aria-label={t("Base branch")}
              onChange={(event) => setReference(event.target.value)}
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
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
