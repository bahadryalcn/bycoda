import { t, useLocale } from "../../shared/i18n";
import { useState } from "react";
import { Check, Clock } from "../../shared/ui/icons";
import "./session-recovery.css";

export function SessionRecoveryControl({
  count,
  onOpen,
  onClear,
}: {
  count: number;
  onOpen: () => void;
  onClear?: () => Promise<void>;
}) {
  useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  if (!count) return null;
  const label = t("Recovered sessions");
  const clear = async () => {
    if (!onClear || pending) return;
    setPending(true);
    setError(false);
    try {
      await onClear();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="recovery-rail-row" aria-busy={pending}>
      <button
        type="button"
        title={`${label} (${count})`}
        aria-label={`${label} (${count})`}
        className="recovery-rail-control flex min-w-0 flex-1 items-center justify-start gap-2 rounded-md px-2 py-2 text-xs text-content/80 hover:bg-content/8 active:bg-content/12 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        disabled={pending}
        onClick={onOpen}
      >
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate @max-[140px]/rail:hidden [[data-compact-project-rail]_&]:hidden">
          {label}
        </span>
        <span className="recovery-rail-count" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      </button>
      {onClear ? (
        <button
          type="button"
          className="recovery-rail-clear recovery-remove"
          title={t("Clear list")}
          aria-label={t("Clear list")}
          disabled={pending}
          onClick={() => void clear()}
        >
          <Check className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="recovery-rail-error text-xs text-red-400">
          {t("Could not update the recovery list. Try again.")}
        </span>
      ) : null}
    </div>
  );
}
