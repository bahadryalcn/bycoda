import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader } from "../../../shared/ui/icons";
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
  const trimmed = name.trim();

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || busy || (branches && !references?.includes(reference))) return;
    onCreate(trimmed, branches ? reference : undefined);
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
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[12px] font-medium text-content/70">{t("Base branch")}</span>
            <select
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              aria-label={t("Base branch")}
              disabled={busy}
              className="h-9 min-w-0 rounded-md border border-content/10 bg-background-base px-2.5 font-sans text-[13px] text-content focus-visible:outline-2 focus-visible:outline-content/50 disabled:opacity-50"
            >
              {references?.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">{t("Branch name")}</span>
          <input
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
            className="h-9 rounded-md border border-content/10 bg-content/5 px-2.5 font-sans text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25 disabled:opacity-50"
          />
        </label>

        {error ? (
          <p role="alert" className="text-[11px] leading-4 text-red-400/90">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40"
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={!trimmed || busy || Boolean(branches && !references?.includes(reference))}
            className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            {busy ? <Loader className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
            {t("Create branch")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
