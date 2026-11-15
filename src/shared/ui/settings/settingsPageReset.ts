import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * Page-level "Restore defaults". A page opts in by calling `useSettingsPageReset(handler)`;
 * the settings shell then shows one header action behind a confirmation. Pages that do not
 * call it show nothing. The handler restores only that page's settings.
 */
export type SettingsPageResetRegistration = { run: () => void | Promise<void> };
export const SettingsPageResetRegistry = createContext<Dispatch<
  SetStateAction<SettingsPageResetRegistration | null>
> | null>(null);

/**
 * Register (non-null) or withdraw (null) this page's reset handler for the shell header.
 * Registers before paint so the header action is present on the page's first frame instead of
 * popping in a frame later and shifting the other header actions.
 */
export function useSettingsPageReset(onReset: (() => void | Promise<void>) | null) {
  const register = useContext(SettingsPageResetRegistry);
  const latest = useRef(onReset);
  useEffect(() => {
    latest.current = onReset;
  });
  const enabled = onReset != null;
  useLayoutEffect(() => {
    if (!register || !enabled) return;
    register({ run: () => latest.current?.() });
    return () => register(null);
  }, [register, enabled]);
}
