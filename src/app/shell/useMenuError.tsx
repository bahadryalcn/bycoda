import { errorText } from "../../shared/lib/errors";
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../shared/i18n";
import { Alert } from "../../shared/ui/Alert";
import { ErrorDetails } from "../../shared/ui/ErrorDetails";
import { toast } from "../../shared/ui/ToastRegion";

/**
 * Menu action errors. While the menu that raised one is still open it shows in
 * that menu's footer (`menuFooter`); once the menu has closed it surfaces as a toast instead of
 * vanishing with the menu. A raw failure shows a translated headline with its text behind Details.
 */
export function useMenuError(menuPath: string | undefined, menuOpen: boolean) {
  const t = useT();
  const [state, setState] = useState<{ path?: string; message: string; details?: string } | null>(
    null,
  );
  const openRef = useRef(menuOpen);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- mirrors the menu's open state into a ref that the async error callback reads after render
  useLayoutEffect(() => {
    openRef.current = menuOpen;
  });
  // An error belongs to the menu it was raised for; it never carries over to another one.
  if (state && state.path !== menuPath) setState(null);
  const handleMenuError = (message: string | null, details?: string) => {
    if (message !== null && !openRef.current)
      toast.show({
        tone: "danger",
        message,
        extra: details ? <ErrorDetails title={message} detail={details} /> : undefined,
      });
    else setState(message === null ? null : { path: menuPath, message, details });
  };
  const handleFailMenuError = (error: unknown) =>
    handleMenuError(t("Could not complete this action."), errorText(error));
  return {
    menuFooter: state ? (
      <Alert
        tone="danger"
        extra={
          state.details ? <ErrorDetails title={state.message} detail={state.details} /> : undefined
        }
      >
        {state.message}
      </Alert>
    ) : null,
    setMenuError: handleMenuError,
    failMenuError: handleFailMenuError,
    clearMenuError: () => setState(null),
  };
}
