import { memo, type ReactNode } from "react";
import { SocialFeedbackContext, SocialPanelActiveContext } from "./socialContext";
import { SocialBusyContext } from "./socialShared";

/** Keep form state, but stop delivering new snapshots/context to inactive trees.
 * React replays all current props (including callbacks) when the panel opens. */
export const RetainedSocialPanel = memo(
  function RetainedSocialPanel({
    active,
    busy,
    error,
    notice,
    className,
    children,
  }: {
    active: boolean;
    busy: boolean;
    error: string;
    notice: string;
    className?: string;
    children: ReactNode;
  }) {
    return (
      <div hidden={!active} className={className}>
        <SocialPanelActiveContext.Provider value={active}>
          <SocialFeedbackContext.Provider value={{ busy, error, notice }}>
            <SocialBusyContext.Provider value={busy}>{children}</SocialBusyContext.Provider>
          </SocialFeedbackContext.Provider>
        </SocialPanelActiveContext.Provider>
      </div>
    );
  },
  (previous, next) => !previous.active && !next.active,
);
