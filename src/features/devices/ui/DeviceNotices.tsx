import { surfaceAttributes } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";

/**
 * The notice slot above the device screen. A device error always shows, and stacks above at most
 * one lower-severity line: a completed action with a stale screen, then the control-tools setup,
 * then the last informational device message, then the reason the toolbar is limited. The error
 * stays until its own dismiss action clears it, so a setup or stale-frame line never hides it.
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
  useLocale();
  const error = notice?.error ? notice : undefined;

  let secondary = null;
  if (actionCompleted)
    secondary = (
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
  else if (setupControl)
    secondary = (
      <Text
        as="div"
        size="caption"
        tone="inherit"
        leading="inherit"
        {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "device-panel-setup-control")}
      >
        <Button
          variant="primary"
          loading={setupControl.pending}
          disabled={setupControl.disabled}
          disabledReason={t(
            "Wait for the current device action to finish, or set up the device first.",
          )}
          onClick={setupControl.onClick}
        >
          {t("Set up device control")}
        </Button>
      </Text>
    );
  else if (notice && !notice.error)
    secondary = (
      <InlineMessage
        tone="info"
        className="shrink-0"
        action={{ label: t("Dismiss"), onClick: notice.onDismiss }}
      >
        {notice.display}
      </InlineMessage>
    );
  else if (reason)
    secondary = (
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

  if (!error) return secondary;
  return (
    <>
      <InlineMessage
        tone="danger"
        className="shrink-0"
        action={{ label: t("Dismiss"), onClick: error.onDismiss }}
      >
        {error.display}
      </InlineMessage>
      {secondary}
    </>
  );
}
