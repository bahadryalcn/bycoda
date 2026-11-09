import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { InlineError } from "../../shared/ui/InlineError";
import { ActionHost, InlineAction } from "../../shared/ui/ActionHost";
import { useT } from "../../shared/i18n";
import { useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Trash2, Clock } from "../../shared/ui/icons";
import { RAIL_SECTION_HEADER, RAIL_SECTION_LABEL } from "./useRailSections";
import {
  getRecoverySaveFailure,
  subscribeRecoverySaveFailure,
} from "../../features/workspace/model/sessionRecovery";
import "./session-recovery.css";

export function SessionRecoveryControl({
  count,
  onOpen,
  onClear,
  allowEmpty = false,
  includeFiles = false,
}: {
  count: number;
  onOpen: () => void;
  onClear?: () => Promise<void>;
  allowEmpty?: boolean;
  includeFiles?: boolean;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const pendingRef = useRef(false);
  const saveFailure = useSyncExternalStore(
    subscribeRecoverySaveFailure,
    getRecoverySaveFailure,
    getRecoverySaveFailure,
  );
  if (!count && !saveFailure && !allowEmpty) return null;
  const label = includeFiles ? t("Recovered work") : t("Recovered sessions");
  const clearLabel = includeFiles ? t("Clear conversation recovery list") : t("Clear list");
  const clear = async () => {
    if (!onClear || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(false);
    try {
      await onClear();
    } catch {
      setError(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return (
    <ActionHost
      className={`recovery-rail-row ${RAIL_SECTION_HEADER}`}
      aria-busy={pending}
      style={{ "--recovery-count-width": `${String(count).length}ch` } as CSSProperties}
    >
      <Button
        variant="item"
        motion="none"
        size="sm"
        type="button"
        tooltip={`${label} (${count})`}
        tooltipWhen={count > 99 ? "always" : "overflow"}
        tooltipSide="right"
        aria-label={`${label} (${count})`}
        className={`recovery-rail-control flex min-w-0 flex-1 items-center justify-start ${RAIL_SECTION_LABEL}`}
        disabled={pending}
        onClick={onOpen}
      >
        <Clock className="icon-sm shrink-0" aria-hidden="true" />
        <span className="recovery-rail-label min-w-0 flex-1 truncate @max-[140px]/rail:hidden [[data-compact-project-rail]_&]:hidden">
          {label}
        </span>
        {count > 0 ? (
          <>
            <Badge
              variant="count"
              size="sm"
              className="recovery-rail-number ms-auto"
              aria-hidden="true"
            >
              {count}
            </Badge>
            {/* A label-less rail has no room for a number beside the icon, so it keeps the corner badge. */}
            <Badge
              variant="count"
              size="sm"
              tone="accent"
              appearance="subtle"
              max={99}
              className="recovery-rail-count"
              aria-hidden="true"
            >
              {count}
            </Badge>
          </>
        ) : null}
      </Button>
      {onClear && count > 0 ? (
        <InlineAction
          label={clearLabel}
          motion="none"
          type="button"
          className="recovery-rail-clear recovery-remove"
          reveal={pending || error ? "always" : "interaction"}
          loading={pending}
          onClick={() => void clear()}
        >
          <Trash2 className="icon-sm" aria-hidden="true" />
        </InlineAction>
      ) : null}
      {error ? (
        <InlineError className="recovery-rail-error">
          {t("Could not update the recovery list. Try again.")}
        </InlineError>
      ) : null}
      {saveFailure ? (
        <InlineError
          className="recovery-rail-error"
          retry={{
            pending,
            onRetry: async () => {
              if (pendingRef.current) return;
              pendingRef.current = true;
              setPending(true);
              try {
                await saveFailure.retry();
              } finally {
                pendingRef.current = false;
                setPending(false);
              }
            },
          }}
        >
          {t("Recovery dismissal was not saved.")}
        </InlineError>
      ) : null}
    </ActionHost>
  );
}
