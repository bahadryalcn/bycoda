import type { ReactNode } from "react";
import { Alert } from "../../../shared/ui/Alert";
import "./BycodaSettings.css";

export type SettingsFeedbackProps = {
  state: "loading" | "success" | "error" | "empty" | "warning";
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  presentation?: "quiet" | "surface" | "inset";
};

export function SettingsOperationFeedback({
  state,
  children,
  action,
  onDismiss,
  presentation = "quiet",
}: SettingsFeedbackProps) {
  return (
    <div className="settings-feedback" data-state={state} data-presentation={presentation}>
      <Alert
        tone={
          state === "error"
            ? "danger"
            : state === "warning"
              ? "warning"
              : state === "success"
                ? "success"
                : "info"
        }
        aria-live={state === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        inline={presentation !== "surface"}
        action={action}
        onDismiss={onDismiss}
        open={onDismiss ? true : undefined}
      >
        {children}
      </Alert>
    </div>
  );
}
