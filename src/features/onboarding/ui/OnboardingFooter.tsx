import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { ReactNode } from "react";
import { Text } from "../../../shared/ui/Text";

/** The one footer rule: the way back on the left, optional Skip plus the primary action on the right. */
export function OnboardingFooter({
  start,
  note,
  children,
}: {
  start: ReactNode;
  /** Muted caption beside the way back, for steps whose choices save as they change. */
  note?: string;
  children: ReactNode;
}) {
  return (
    <footer
      {...surfaceAttributes(
        { frame: "stroke", edge: "block-start", variant: "base" },
        "onboarding-footer",
      )}
    >
      <div className="onboarding-footer-start">
        {start}
        {note ? (
          <Text as="span" size="micro" tone="muted" className="onboarding-save-note">
            {note}
          </Text>
        ) : null}
      </div>
      <div className="onboarding-footer-actions">{children}</div>
    </footer>
  );
}
