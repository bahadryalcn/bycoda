import { useEffect, useRef, useState } from "react";
import { ApprovalRequest } from "../../../shared/ui/ApprovalRequest";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";

type Request = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  onConfirm: () => Promise<unknown>;
};
type Live = { id: number; request: Request; resolve: (approved: boolean) => void };

/** Phone consent keeps its async operation and retry state inside the shared modal owner. */
export function usePhoneApprovalRequest() {
  const [live, setLive] = useState<Live | null>(null);
  const current = useRef<Live | null>(null);
  const sequence = useRef(0);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- settles the pending confirm promise held until unmount
  useEffect(
    () => () => {
      current.current?.resolve(false);
      current.current = null;
    },
    [],
  );
  const settle = (value: boolean) => {
    const active = current.current;
    current.current = null;
    setLive(null);
    active?.resolve(value);
  };
  return {
    confirm: (request: Request) =>
      new Promise<boolean>((resolve) => {
        current.current?.resolve(false);
        const next = { id: ++sequence.current, request, resolve };
        current.current = next;
        setLive(next);
      }),
    dialog: live ? (
      <PhoneApprovalDialog
        key={live.id}
        request={live.request}
        current={() => current.current === live}
        onSettle={settle}
      />
    ) : null,
  };
}

function PhoneApprovalDialog({
  request,
  current,
  onSettle,
}: {
  request: Request;
  current: () => boolean;
  onSettle: (value: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const allow = async () => {
    if (inFlight.current || !current()) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await request.onConfirm();
      if (current()) onSettle(true);
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPending(false);
        inFlight.current = false;
      }
    }
  };
  return (
    <Modal
      size="sm"
      title={request.title}
      onClose={() => {
        if (!inFlight.current) onSettle(false);
      }}
    >
      <ApprovalRequest
        title={request.title}
        detail={request.message}
        allow={{
          label: pending ? request.pendingLabel : request.confirmLabel,
          pending,
          disabled: pending,
          onClick: () => void allow(),
        }}
        deny={{ label: request.cancelLabel, disabled: pending, onClick: () => onSettle(false) }}
      />
      {error ? <InlineError>{error}</InlineError> : null}
    </Modal>
  );
}
