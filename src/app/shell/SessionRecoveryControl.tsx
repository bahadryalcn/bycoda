import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
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
    <div className="recovery-rail-row group" aria-busy={pending}>
      <Button
        variant="item"
        motion="none"
        type="button"
        title={`${label} (${count})`}
        aria-label={`${label} (${count})`}
        className="recovery-rail-control flex min-w-0 flex-1 items-center justify-start gap-2"
        disabled={pending}
        onClick={onOpen}
      >
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        <span className="recovery-rail-label min-w-0 flex-1 truncate @max-[140px]/rail:hidden [[data-compact-project-rail]_&]:hidden">
          {label}
        </span>
        <Badge className="recovery-rail-count" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </Badge>
      </Button>
      {onClear ? (
        <Button
          iconOnly
          label={t("Clear list")}
          variant="ghost"
          motion="none"
          type="button"
          className="recovery-rail-clear recovery-remove opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          title={t("Clear list")}
          aria-label={t("Clear list")}
          disabled={pending}
          onClick={() => void clear()}
        >
          <Check className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
      {error ? (
        <span role="alert" className="recovery-rail-error text-xs text-danger">
          {t("Could not update the recovery list. Try again.")}
        </span>
      ) : null}
    </div>
  );
}
