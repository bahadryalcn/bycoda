import type { ReactNode } from "react";

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
    <footer className="onboarding-footer">
      <div className="onboarding-footer-start">
        {start}
        {note ? <span className="onboarding-save-note">{note}</span> : null}
      </div>
      <div className="onboarding-footer-actions">{children}</div>
    </footer>
  );
}
