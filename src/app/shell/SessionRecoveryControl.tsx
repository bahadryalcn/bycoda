import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { InlineError } from "../../shared/ui/InlineError";
import { Popover } from "../../shared/ui/Popover";
import { useConfirm } from "../../shared/ui/ConfirmDialog";
import { useT } from "../../shared/i18n";
import { useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "../../shared/ui/icons";
import {
  getRecoverySaveFailure,
  subscribeRecoverySaveFailure,
} from "../../features/workspace/model/sessionRecovery";

export function SessionRecoveryControl({
  count,
  onOpen,
  onClear,
  includeFiles = false,
}: {
  count: number;
  onOpen: () => void;
  onClear?: () => Promise<void>;
  includeFiles?: boolean;
}) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const anchor = useRef<HTMLButtonElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [clearError, setClearError] = useState(false);
  const pendingRef = useRef(false);
  const saveFailure = useSyncExternalStore(
    subscribeRecoverySaveFailure,
    getRecoverySaveFailure,
    getRecoverySaveFailure,
  );
  if (!count && !saveFailure && !pending) return null;

  const label = includeFiles ? t("Recovered work") : t("Recovered sessions");
  const clearLabel = t("Dismiss recovered sessions");
  const failure = saveFailure
    ? t("Recovery dismissal was not saved.")
    : clearError
      ? t("Could not update the recovery list. Try again.")
      : undefined;
  const canClear = !!onClear && count > 0;
  const showOptions = optionsOpen && (canClear || !!failure);
  const endPending = () => {
    pendingRef.current = false;
    setPending(false);
  };
  const confirmClear = async () => {
    if (!onClear || pendingRef.current) return;
    setOptionsOpen(false);
    const ok = await confirm({
      title: t("Dismiss recovered sessions?"),
      message: t(
        "They leave the recovery list. Their session history is kept and running work is not stopped.",
      ),
      confirmLabel: clearLabel,
      danger: false,
    });
    if (!ok || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setClearError(false);
    await Promise.resolve()
      .then(onClear)
      .catch(() => {
        setClearError(true);
        setOptionsOpen(true);
      })
      .finally(endPending);
  };
  const retrySave = async () => {
    if (!saveFailure || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    await Promise.resolve()
      .then(() => saveFailure.retry())
      .then(() => setOptionsOpen(false))
      .finally(endPending);
  };

  return (
    <>
      <Button
        ref={anchor}
        data-recovery-control
        variant="ghost"
        className="relative"
        tone={failure ? "danger" : undefined}
        motion="none"
        iconOnly
        label={`${label} (${count})`}
        tooltip={failure}
        tooltipSide="top"
        aria-haspopup="dialog"
        aria-expanded={canClear || failure ? showOptions : undefined}
        loading={pending}
        onClick={() => {
          if (failure) setOptionsOpen((open) => !open);
          else {
            setOptionsOpen(false);
            onOpen();
          }
        }}
        onContextMenu={(event) => {
          if (!canClear && !failure) return;
          event.preventDefault();
          setOptionsOpen(true);
        }}
        onKeyDown={(event) => {
          if (!canClear && !failure) return;
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          setOptionsOpen(true);
        }}
      >
        <RotateCcw className="icon-md" aria-hidden />
        {count > 0 ? (
          <span className="pointer-events-none absolute -inset-bs-2 -end-1 inline-flex w-max whitespace-nowrap">
            <Badge variant="count" size="xs" leading="none" aria-hidden>
              {count}
            </Badge>
          </span>
        ) : null}
      </Button>
      {showOptions ? (
        <Popover
          anchor={anchor}
          kind="dialog"
          aria-label={label}
          side="top"
          align="end"
          onDismiss={() => setOptionsOpen(false)}
        >
          <div className="flex flex-col gap-2">
            {failure ? (
              <InlineError
                retry={
                  saveFailure
                    ? { pending, onRetry: () => void retrySave().catch(console.error) }
                    : undefined
                }
              >
                {failure}
              </InlineError>
            ) : null}
            {failure && count > 0 ? (
              <Button
                onClick={() => {
                  setOptionsOpen(false);
                  onOpen();
                }}
              >
                {label}
              </Button>
            ) : null}
            {canClear ? (
              <Button onClick={() => void confirmClear().catch(console.error)} disabled={pending}>
                {clearLabel}
              </Button>
            ) : null}
          </div>
        </Popover>
      ) : null}
      {dialog}
    </>
  );
}
