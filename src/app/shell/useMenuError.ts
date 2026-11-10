import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "../../shared/ui/ToastRegion";

/**
 * Menu action errors. While the menu that raised one is still open it shows in
 * that menu's footer; once the menu has closed it surfaces as a toast instead of
 * vanishing with the menu.
 */
export function useMenuError(menuPath: string | undefined, menuOpen: boolean) {
  const [state, setState] = useState<{ path?: string; message: string } | null>(null);
  const openRef = useRef(menuOpen);
  useLayoutEffect(() => {
    openRef.current = menuOpen;
  });
  // An error belongs to the menu it was raised for; it never carries over to another one.
  if (state && state.path !== menuPath) setState(null);
  const setMenuError = (message: string | null) => {
    if (message !== null && !openRef.current) toast.show({ tone: "danger", message });
    else setState(message === null ? null : { path: menuPath, message });
  };
  return {
    menuError: state ? state.message : null,
    setMenuError,
    failMenuError: (error: unknown) =>
      setMenuError(error instanceof Error ? error.message : String(error)),
    clearMenuError: () => setState(null),
  };
}
