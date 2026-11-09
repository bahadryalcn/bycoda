import { useLayoutEffect, useRef } from "react";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { useSessionDeleteDialogRequest } from "./sessionDeleteDialogRequest";

export type SessionDeleteChoice = {
  confirmed: boolean;
  deleteWorktree: boolean;
};

export function DeleteSessionDialog({
  title,
  unusedWorktree,
  onClose,
}: {
  title: string;
  unusedWorktree: string;
  onClose: (choice: SessionDeleteChoice) => void;
}) {
  const { confirmWith, renderDialog } = useConfirm();
  const onCloseRef = useRef(onClose);
  const generationRef = useRef(0);
  onCloseRef.current = onClose;
  const request = useSessionDeleteDialogRequest(title, unusedWorktree);
  const requestRef = useRef(request);
  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    void confirmWith(requestRef.current)
      .then(
        (result) => {
          if (generation === generationRef.current) {
            onCloseRef.current({
              confirmed: result !== null,
              deleteWorktree: result?.acknowledged ?? false,
            });
          }
        },
        (error: unknown) => {
          console.error("Session delete confirmation failed", error);
          if (generation === generationRef.current) {
            onCloseRef.current({ confirmed: false, deleteWorktree: false });
          }
        },
      )
      .catch((error: unknown) => {
        console.error("Session delete confirmation callback failed", error);
      });
    return () => {
      generationRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once; renderDialog supplies current display request.
  }, []);
  return renderDialog(request);
}
