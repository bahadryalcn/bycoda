import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { hostModeSwitchView, useHostLifecycleMode } from "../model/hostLifecycleMode";

/**
 * The "This computer" row's switch: keep the local Host running when bycoda is closed. While
 * running sessions block a change it shows the pending change, which applies when idle;
 * "Switch now" interrupts them after a confirmation.
 */
export function LocalHostModeSwitch() {
  useLocale();
  const { status, switching, failure, apply } = useHostLifecycleMode();
  const { confirm, dialog } = useConfirm();
  if (!status) return null;
  const view = hostModeSwitchView(status);
  const error = failure ?? view.error;
  const switchNow = async () => {
    if (!view.pending) return;
    const approved = await confirm({
      title: t("Switch this computer's host now?"),
      message: t("The host restarts to apply the change."),
      consequences: [
        {
          tone: "warning",
          content: t("Running sessions and shells on this computer are interrupted."),
        },
        { content: t("Session history is kept.") },
      ],
      confirmLabel: t("Stop and switch"),
      danger: true,
    });
    if (approved) await apply(view.pending, true);
  };
  return (
    <div className="mbs-1 flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Switch
          label={t("Keep this computer reachable when bycoda is closed")}
          checked={view.pending ? view.pending === "service" : view.checked}
          disabled={view.unsupported || switching}
          onCheckedChange={(on) => void apply(on ? "service" : "app", false)}
        />
        <InfoPopover label={t("About keeping this computer reachable")} className="shrink-0">
          <Text as="p">
            {t(
              "Your phone and other computers can reach this computer's projects while bycoda is closed, and automations keep running. When off, this computer's host starts and stops with bycoda.",
            )}
          </Text>
          {view.unsupported ? (
            <Text as="p" tone="muted" className="mbs-2">
              {t("Update this computer's Host to change this.")}
            </Text>
          ) : null}
        </InfoPopover>
        {switching ? (
          <Text tone="muted" as="span">
            {t("Switching…")}
          </Text>
        ) : null}
      </div>
      {view.pending && !switching ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
          <Text tone="muted" as="span">
            {view.pending === "service"
              ? t("Turning on when running sessions finish")
              : t("Turning off when running sessions finish")}
          </Text>
          <Button variant="link" size="sm" onClick={() => void switchNow()}>
            {t("Switch now")}
          </Button>
        </div>
      ) : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      {dialog}
    </div>
  );
}
