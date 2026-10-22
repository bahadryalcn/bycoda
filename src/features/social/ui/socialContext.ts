import { createContext } from "react";

// Portalled selection menus share the workspace's pending-operation state.
export const SocialBusyContext = createContext(false);
export const SocialPanelActiveContext = createContext(true);

export const SocialFeedbackContext = createContext({ busy: false, error: "", notice: "" });
