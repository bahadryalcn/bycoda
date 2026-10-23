import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { Notice, StatusBadge, type Props } from "./socialShared";

export function SocialSendingControls({ snapshot, client, run }: Props) {
  useLocale();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const execute = async (key: string, action: () => Promise<unknown>, message: string) => {
    if (pending) return;
    setPending(key);
    try {
      await run(action, message);
    } finally {
      setPending(null);
    }
  };
  return (
    <section className="social-sending-controls" aria-label={t("Sending controls")}>
      <header className="social-section-heading">
        <h2>{t("Sending controls")}</h2>
        <StatusBadge
          status={snapshot.stopped ? "paused" : snapshot.sendingEnabled ? "active" : "draft"}
          label={
            snapshot.stopped
              ? t("Paused")
              : snapshot.sendingEnabled
                ? t("Approved sends on")
                : t("Sending off")
          }
        />
      </header>
      <Notice
        kind={snapshot.stopped || !snapshot.sendingEnabled ? "warning" : "success"}
        title={snapshot.stopped ? t("Pending jobs are kept") : t("Approval is required to send")}
      >
        {snapshot.stopped
          ? t("Resume sending when you are ready.")
          : t("Drafts are never sent. Only content you approve and active rules can send.")}
      </Notice>
      {!snapshot.hostOnline ? (
        <Notice kind="warning" title={t("Cannot reach the sending service")}>
          {t("Check the selected computer's connection to manage operations.")}
        </Notice>
      ) : null}
      {!snapshot.sendingEnabled ? (
        <div className="social-confirm">
          <label className="social-inline-check">
            <Checkbox
              checked={confirmed}
              disabled={!!pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("Content I approve and active rules may send from my real accounts.")}
          </label>
          <Button
            variant="primary"
            type="button"
            loading={pending === "enable"}
            disabled={!confirmed || !snapshot.hostOnline || !!pending}
            onClick={() =>
              void execute(
                "enable",
                () => client.request("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" }),
                t("Approved sends enabled. Drafts still need separate approval."),
              )
            }
          >
            {t("Enable approved sends")}
          </Button>
        </div>
      ) : null}
      <div className="social-setting-row">
        <div>
          <h3>{t("All sending")}</h3>
          <p className="social-muted">{t("Pause sending without deleting plans or content.")}</p>
        </div>
        <Button
          variant="secondary"
          type="button"
          tone={snapshot.stopped ? "neutral" : "danger"}
          loading={pending === "stop"}
          disabled={!snapshot.hostOnline || !!pending}
          onClick={() =>
            void execute(
              "stop",
              () => client.request("execution.stop", { stopped: !snapshot.stopped }),
              snapshot.stopped ? t("Sending resumed.") : t("All sending stopped."),
            )
          }
        >
          {snapshot.stopped ? t("Resume sending") : t("Stop all sending")}
        </Button>
      </div>
      <div className="social-setting-row">
        <div>
          <h3>{t("Auto-refresh inbox")}</h3>
          <p className="social-muted">
            {t("Only accounts with message and comment read access are refreshed.")}
          </p>
          <StatusBadge
            status={snapshot.pollingEnabled ? "active" : "paused"}
            label={snapshot.pollingEnabled ? t("Auto-refresh on") : t("Auto-refresh off")}
          />
        </div>
        <Button
          variant="secondary"
          type="button"
          loading={pending === "polling"}
          disabled={!!pending}
          onClick={() =>
            void execute(
              "polling",
              () => client.request("inbox.polling", { enabled: !snapshot.pollingEnabled }),
              snapshot.pollingEnabled
                ? t("Inbox auto-refresh turned off.")
                : t("Auto-refresh turned on for permitted accounts."),
            )
          }
        >
          {snapshot.pollingEnabled ? t("Turn off auto-refresh") : t("Turn on auto-refresh")}
        </Button>
      </div>
    </section>
  );
}
