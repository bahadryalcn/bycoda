import { createContext } from "react";

/**
 * Context holding the native popup window element a surface is rendered into, so nested overlays skip their own
 * positioning, clipping and shadow. Provided by popup roots; consumed by Popover and menus.
 * @status internal
 */
export const NativePopupHost = createContext<HTMLElement | null>(null);
