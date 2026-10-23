import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Modal } from "./Modal";

export type ConfirmRequest = {
  title: string;
  message: ReactNode;
  /** Label of the confirming button, e.g. "Delete". */
  confirmLabel: string;
  /** Destructive confirmations use the danger tone. Default true. */
  danger?: boolean;
  /**
   * Optional async work run on confirm. The dialog stays open with both buttons
   * disabled until it settles; a rejection keeps the dialog open with the error.
   */
  onConfirm?: () => void | Promise<void>;
};

type Live = { request: ConfirmRequest; resolve: (value: boolean) => void };

/**
 * One confirmation for multi-consequence actions: a Modal with Cancel and a
 * (danger) confirm button. Row-level deletes use ConfirmMorph instead; the Tauri
 * `ask` dialog is only for places a web overlay cannot render.
 */
export function ConfirmDialog({
  request,
  onSettle,
}: {
  request: ConfirmRequest;
  onSettle: (value: boolean) => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const confirm = async () => {
    if (pending) return;
    if (!request.onConfirm) return onSettle(true);
    setPending(true);
    setError(null);
    try {
      await request.onConfirm();
      onSettle(true);
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={request.title}
      onClose={() => {
        if (!pending) onSettle(false);
      }}
      footer={
        <>
          <Button
            variant="ghost"
            className="ms-auto"
            disabled={pending}
            onClick={() => onSettle(false)}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant={request.danger === false ? "primary" : "danger"}
            loading={pending}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {request.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 px-4 py-3 text-ui-secondary break-words text-(--ui-text-secondary)">
        <p>{request.message}</p>
        {error ? (
          <p role="alert" className="text-ui-caption text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Promise-based confirmation. `confirm()` resolves true only when the owner
 * confirms (and `onConfirm`, if any, succeeded); closing resolves false. Render
 * `dialog` once in the owning component.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [live, setLive] = useState<Live | null>(null);
  const ref = useRef<Live | null>(null);
  const confirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        ref.current?.resolve(false);
        const next = { request, resolve };
        ref.current = next;
        setLive(next);
      }),
    [],
  );
  useEffect(
    () => () => {
      ref.current?.resolve(false);
      ref.current = null;
    },
    [],
  );
  const settle = useCallback((value: boolean) => {
    const current = ref.current;
    ref.current = null;
    setLive(null);
    current?.resolve(value);
  }, []);
  return {
    confirm,
    dialog: live ? (
      <ConfirmDialog key={live.request.title} request={live.request} onSettle={settle} />
    ) : null,
  };
}
