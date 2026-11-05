import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  useConfirm,
  type ConfirmRequest,
} from "../../../shared/ui/ConfirmDialog";

export function useProjectConfirmDialog(
  request: ConfirmRequest,
  onCancel: () => void,
): ReactNode {
  const confirmation = useConfirm();
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useLayoutEffect(() => {
    let active = true;
    void confirmation.confirmWith(request).then(
      (result) => {
        if (active && !result) cancel.current();
      },
      () => {
        if (active) cancel.current();
      },
    );
    return () => {
      active = false;
    };
    // Open once; renderDialog supplies current request content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return confirmation.renderDialog(request);
}
