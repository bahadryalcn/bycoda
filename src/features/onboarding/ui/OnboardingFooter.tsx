import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { ReactNode } from "react";

/** The one footer rule: the way back on the left, optional Skip plus the primary action on the right. */
export function OnboardingFooter({ start, children }: { start: ReactNode; children: ReactNode }) {
  return (
    <footer
      {...surfaceAttributes(
        { frame: "pane", edge: "block-start", variant: "canvas" },
        "onboarding-footer",
      )}
    >
      <div className="onboarding-footer-start">{start}</div>
      <div className="onboarding-footer-actions">{children}</div>
    </footer>
  );
}
