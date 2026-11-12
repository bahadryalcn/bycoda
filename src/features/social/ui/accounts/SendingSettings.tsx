import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Group, Row } from "../../../settings/public/settingsControls";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
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
 * Sending on this computer: turn approved sends on, or stop all sending. Every button that cannot
 * act says why, because the Host is the only place that can change these flags.
 */
export function SendingSettings({ client, snapshot, hostOnline, onChanged }: SendingSettingsProps) {
  const [confirmed, setConfirmed] = useState(false);
  const { error, is, write } = useAccountWrite(t("Sending could not be changed. Try again."));
  const offline = hostOnline ? undefined : t("Connect to this computer to change sending.");
  const enableGate: ActionGate = offline
    ? { disabled: true, disabledReason: offline }
    : !confirmed
      ? { disabled: true, disabledReason: t("Tick the box above to allow sending.") }
      : { disabled: false };
  const stopGate: ActionGate = offline
    ? { disabled: true, disabledReason: offline }
    : { disabled: false };
  const status = snapshot.stopped ? "paused" : snapshot.sendingEnabled ? "on" : "off";

  const tone: BadgeTone = snapshot.stopped
    ? "warning"
    : snapshot.sendingEnabled
      ? "success"
      : "neutral";

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
      feedback={error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
    >
      {!snapshot.sendingEnabled ? (
        <Row label={t("Enable approved sends")} stacked>
          <div className="social-field-row">
            <Checkbox
              checked={confirmed}
              disabled={is("sending.enable") || !!offline}
              onChange={(event) => setConfirmed(event.target.checked)}
              label={t("Content I approve and active rules may send from my real accounts.")}
              size="secondary"
              leading="inherit"
              className="social-check"
            />
            <DisabledReason
              variant="primary"
              size="sm"
              loading={is("sending.enable")}
              onClick={() =>
                void write("sending.enable", () =>
                  client.request("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" }),
                )
                  .then((result) => result !== undefined && onChanged())
                  .catch(() => undefined)
              }
              {...gateProps(enableGate)}
            >
              {t("Enable approved sends")}
            </DisabledReason>
          </div>
        </Row>
      ) : null}
      <Row
        label={snapshot.stopped ? t("Resume sending") : t("Stop all sending")}
        description={snapshot.stopped ? t("Pending jobs are kept") : undefined}
      >
        <DisabledReason
          variant={snapshot.stopped ? "secondary" : "danger"}
          size="sm"
          loading={is("sending.stop")}
          onClick={() =>
            void write("sending.stop", () =>
              client.request("execution.stop", { stopped: !snapshot.stopped }),
            )
              .then((result) => result !== undefined && onChanged())
              .catch(() => undefined)
          }
          {...gateProps(stopGate)}
        >
          {snapshot.stopped ? t("Resume sending") : t("Stop all sending")}
        </DisabledReason>
      </Row>
    </Group>
  );
}
