import { InlineError } from "../../../../shared/ui/InlineError";
import { t } from "../../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Group, Row } from "../../../../shared/ui/settings";
import type { SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type SendingSettingsProps = {
  client: SocialClient;
  snapshot: SocialSnapshot;
  hostOnline: boolean;
  onChanged(): void;
};

/**
 * Sending on this computer: turn approved sends on, or stop all sending. Enabling asks the owner
 * for an explicit confirmation in a dialog; a button that cannot act says why in its tooltip,
 * because the Host is the only place that can change these flags.
 */
export function SendingSettings({ client, snapshot, hostOnline, onChanged }: SendingSettingsProps) {
  const { confirm, dialog } = useConfirm();
  const { error, is, write } = useAccountWrite(t("Sending could not be changed. Try again."));
  const offline = hostOnline ? undefined : t("Connect to this computer to change sending.");
  const status = snapshot.stopped ? "paused" : snapshot.sendingEnabled ? "on" : "off";

  const tone: BadgeTone = snapshot.stopped
    ? "warning"
    : snapshot.sendingEnabled
      ? "success"
      : "neutral";

  const enable = () =>
    void confirm({
      title: t("Enable approved sends?"),
      message: t("Content I approve and active rules may send from my real accounts."),
      confirmLabel: t("Enable approved sends"),
      danger: false,
      onConfirm: async () => {
        await client.request("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
        onChanged();
      },
    }).catch(() => undefined);

  return (
    <Group
      title={t("Sending on this computer")}
      description={t(
        "Approved posts, active rules, automatic programs and autonomous AI can send.",
      )}
      action={
        <span data-status={status}>
          <Badge tone={tone} size="sm">
            {snapshot.stopped
              ? t("Paused")
              : snapshot.sendingEnabled
                ? t("Approved sends on")
                : t("Sending off")}
          </Badge>
        </span>
      }
      feedback={
        error ? (
          <InlineError details={error}>{t("Sending could not be changed. Try again.")}</InlineError>
        ) : null
      }
    >
      {!snapshot.sendingEnabled ? (
        <Row label={t("Approved sends")}>
          <Button
            variant="primary"
            size="sm"
            onClick={enable}
            disabled={!!offline}
            disabledReason={offline}
          >
            {t("Enable")}
          </Button>
        </Row>
      ) : null}
      <Row label={t("All sending")}>
        <Button
          variant="secondary"
          tone={snapshot.stopped ? "neutral" : "danger"}
          size="sm"
          loading={is("sending.stop")}
          onClick={() =>
            void write("sending.stop", () =>
              client.request("execution.stop", { stopped: !snapshot.stopped }),
            )
              .then((result) => result !== undefined && onChanged())
              .catch(() => undefined)
          }
          disabled={!!offline}
          disabledReason={offline}
        >
          {snapshot.stopped ? t("Resume") : t("Stop")}
        </Button>
      </Row>
      {dialog}
    </Group>
  );
}
