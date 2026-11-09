import type { ReactNode } from "react";
import { useDelayedVisible } from "../../../shared/hooks/useDelayedVisible";
import { Alert } from "../../../shared/ui/Alert";
import "./BycodaSettings.css";

export type SettingsFeedbackProps = {
  state: "loading" | "success" | "error" | "empty" | "warning";
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  presentation?: "quiet" | "surface" | "inset";
  /**
   * `state="loading"` waits for the shared loading delay and renders nothing before it, so a quick
   * load never flashes. Set `immediate` for feedback on a user's own action (saving, a request
   * they started), which must respond at once.
   */
  immediate?: boolean;
};

export function SettingsOperationFeedback({
  state,
  children,
  action,
  onDismiss,
  presentation = "quiet",
  immediate = false,
}: SettingsFeedbackProps) {
  const passive = state === "loading" && !immediate;
  const waited = useDelayedVisible(passive);
  if (passive && !waited) return null;
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
