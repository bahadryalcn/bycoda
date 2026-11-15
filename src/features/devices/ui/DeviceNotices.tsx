import { surfaceAttributes } from "../../../shared/ui/Surface";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";

/**
 * The one notice slot above the device screen. Several conditions can hold at once; only the
 * most urgent shows: a completed action with a stale screen, then the control-tools setup,
 * then the last device message, then the reason the toolbar is limited.
 */
export function DeviceNotices({
  actionCompleted,
  refreshFrame,
  setupControl,
  notice,
  reason,
}: {
  actionCompleted: boolean;
  refreshFrame: { pending: boolean; disabled: boolean; onClick: () => void };
  /** Set when control is on but its tools are missing. */
  setupControl?: { pending: boolean; disabled: boolean; onClick: () => void };
  notice?: { error: boolean; display: string; onDismiss: () => void };
  reason?: string;
}) {
  if (actionCompleted)
    return (
      <InlineMessage
        tone="warning"
        action={{
          label: t("Refresh frame"),
          pending: refreshFrame.pending,
          disabled: refreshFrame.disabled,
          onClick: refreshFrame.onClick,
        }}
      >
        <strong>{t("Action completed")} </strong>
        {t("The screen could not be refreshed. Refresh the frame; do not repeat the action.")}
      </InlineMessage>
    );
  if (setupControl)
    return (
      <Text
        as="div"
        size="caption"
        tone="inherit"
        leading="inherit"
        {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "device-panel-setup-control")}
      >
        <span>{t("Run setup with control enabled to install the control tools.")}</span>
        <Button
          variant="primary"
          loading={setupControl.pending}
          disabled={setupControl.disabled}
          onClick={setupControl.onClick}
        >
          {t("Set up device control")}
        </Button>
      </Text>
    );
  if (notice)
    return (
      <InlineMessage
        tone={notice.error ? "danger" : "info"}
        className="shrink-0"
        action={{ label: t("Dismiss"), onClick: notice.onDismiss }}
      >
        {notice.display}
      </InlineMessage>
    );
  if (reason)
    return (
      <Text
        as="p"
        size="caption"
        tone="secondary"
        leading="inherit"
        {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "device-panel-reason")}
      >
        {reason}
      </Text>
    );
  return null;
}
