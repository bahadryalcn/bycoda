import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { InlineError } from "../../shared/ui/InlineError";
import { Popover } from "../../shared/ui/Popover";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
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
  if (!count && !saveFailure && !clearError && !pending) return null;

  const label = includeFiles ? t("Recovered work") : t("Recovered sessions");
  const clearLabel = t("Dismiss recovered sessions");
  const problem = saveFailure
    ? t("Recovery dismissal was not saved.")
    : clearError
      ? t("Could not update the recovery list. Try again.")
      : undefined;
  const canClear = !!onClear && count > 0;
  const showOptions = optionsOpen && (canClear || !!problem);
  const endPending = () => {
    pendingRef.current = false;
    setPending(false);
  };
  const clear = async () => {
    if (!onClear || pendingRef.current) return;
    setOptionsOpen(false);
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
        tone={problem ? "danger" : undefined}
        motion="none"
        iconOnly
        label={`${label} (${count})`}
        badge={
          count > 0 ? (
            <Badge variant="count" size="xs" leading="none">
              {count}
            </Badge>
          ) : undefined
        }
        aria-haspopup="dialog"
        aria-expanded={canClear || problem ? showOptions : undefined}
        loading={pending}
        onClick={() => {
          if (problem && !count) setOptionsOpen((open) => !open);
          else {
            setOptionsOpen(false);
            onOpen();
          }
        }}
        onContextMenu={(event) => {
          if (!canClear && !problem) return;
          event.preventDefault();
          setOptionsOpen(true);
        }}
        onKeyDown={(event) => {
          if (!canClear && !problem) return;
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          setOptionsOpen(true);
        }}
      >
        <RotateCcw className="icon-md" aria-hidden />
      </Button>
      {showOptions && !problem && canClear ? (
        <DropdownMenu
          anchor={anchor}
          label={label}
          side="top"
          align="end"
          items={[{ kind: "item", id: "dismiss", label: clearLabel }]}
          onClose={() => setOptionsOpen(false)}
          onPick={() => void clear().catch(console.error)}
        />
      ) : null}
      {showOptions && problem ? (
        <Popover
          anchor={anchor}
          kind="dialog"
          aria-label={label}
          side="top"
          align="end"
          onDismiss={() => setOptionsOpen(false)}
        >
          <InlineError
            retry={{
              pending,
              onRetry: () => void (saveFailure ? retrySave() : clear()).catch(console.error),
            }}
          >
            {problem}
          </InlineError>
        </Popover>
      ) : null}
    </>
  );
}
