import { createContext } from "react";

// Portalled selection menus share the workspace's pending-operation state.
export const SocialBusyContext = createContext(false);
export const SocialPanelActiveContext = createContext(true);

/** The shared Modal footer of the open dialog that hosts a Composer form (null when parked or inline). */
export const ComposerFooterContext = createContext<HTMLElement | null>(null);

export const SocialFeedbackContext = createContext({ busy: false, error: "", notice: "" });
