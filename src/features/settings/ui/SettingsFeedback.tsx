import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import type { ReactNode } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { NoticeLink, type NoticeAction } from "../../../shared/ui/Notice";
import { useT } from "../../../shared/i18n";
import "./BycodaSettings.css";

export type SettingsFeedbackProps = {
  state: "loading" | "success" | "error" | "empty" | "warning";
  children: ReactNode;
  /** The one follow-up (Retry, Open settings); the notice renders it. */
  action?: NoticeAction;
  secondaryAction?: NoticeAction;
  /** One non-button control after the actions (a menu or details trigger). */
  extra?: ReactNode;
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
  secondaryAction,
  extra,
  onDismiss,
  presentation = "quiet",
  immediate = false,
}: SettingsFeedbackProps) {
  const t = useT();
  if (state === "loading")
    return (
      <LoadingText delay={!immediate}>
        {children}
        {action ? <NoticeLink action={action} /> : null}
        {extra}
      </LoadingText>
    );
  if (state === "empty")
    return (
      <EmptyState
        size="inline"
        description={children}
        action={action}
        secondaryAction={secondaryAction}
        extra={extra}
      />
    );
  const tone =
    state === "error"
      ? "danger"
      : state === "warning"
        ? "warning"
        : state === "success"
          ? "success"
          : "info";
  const live = state === "error" ? "assertive" : "polite";
  const dismiss: NoticeAction | undefined = onDismiss
    ? { label: t("Dismiss"), onClick: onDismiss }
    : undefined;
  return (
    <div className="settings-feedback" data-state={state} data-presentation={presentation}>
      {presentation === "surface" ? (
        <Alert
          tone={tone}
          aria-live={live}
          aria-atomic="true"
          action={action}
          secondaryAction={secondaryAction}
          extra={extra}
          onDismiss={onDismiss}
          open={onDismiss ? true : undefined}
        >
          {children}
        </Alert>
      ) : state === "error" ? (
        <InlineError
          live={live}
          action={action}
          secondaryAction={secondaryAction ?? dismiss}
          extra={extra}
        >
          {children}
        </InlineError>
      ) : (
        <InlineMessage
          tone={tone}
          live={live}
          action={action}
          secondaryAction={secondaryAction ?? dismiss}
          extra={extra}
        >
          {children}
        </InlineMessage>
      )}
    </div>
  );
}
