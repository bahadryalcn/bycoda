import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { OverlayParent, useOverlay } from "../../../shared/ui/overlay";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { prettyCwd } from "../../../shared/lib/paths";

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
  const dialogRoot = useRef<HTMLFormElement>(null);
  const overlayId = useOverlay(dialogRoot, true, onCancel);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return createPortal(
    <OverlayParent.Provider value={overlayId}>
      <div
        className="fixed inset-0"
        style={{ zIndex: LAYER.dialog }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-scrim/30" />
        <form
          ref={dialogRoot}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={t("Rename project")}
          onMouseDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            const problem = validate(value);
            setError(problem);
            if (!problem) onConfirm(value.trim());
          }}
          className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-content/5 p-4 shadow-xl backdrop-blur-xl"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-[13px] font-medium leading-tight text-content">
              {t("Rename project")}
            </h2>
            <p className="text-[12px] leading-snug text-content/55">
              {t('A project named "')}
              {name}
              {t('" already exists. Give this one a different name.')}
            </p>
            <p className="truncate text-[11px] leading-tight text-content/40">{prettyCwd(path)}</p>
          </div>
          <input
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
            className="h-8 shrink-0 rounded-md border border-content/10 bg-content/3 px-2.5 text-[13px] text-content outline-none focus:border-content/25"
          />
          {error ? (
            <p role="alert" className="text-[12px] leading-snug text-danger/90">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              title={t('Keep "{p0}"', { p0: suggested })}
              className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover"
            >
              {t("Rename")}
            </button>
          </div>
        </form>
      </div>
    </OverlayParent.Provider>,
    document.body,
  );
}
