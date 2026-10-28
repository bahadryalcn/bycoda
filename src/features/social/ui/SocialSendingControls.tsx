import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useRef, useState } from "react";
import { Notice, StatusBadge, type Props } from "./socialShared";

export function SocialSendingControls({ snapshot, client, run, executorLabel }: Props & { executorLabel?: string }) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const operation = useRef(false);
  const execute = async (key: string, action: () => Promise<unknown>, message: string) => {
    if (operation.current) return;
    operation.current = true;
    setPending(key);
    try {
      await run(action, message);
    } finally {
      operation.current = false;
      setPending(null);
    }
  };
  return (
    <section className="social-sending-controls" aria-label={t("Sending controls")}>
      <header className="social-section-heading">
        <div className="min-w-0"><h2>{t("Sending on this computer")}</h2>{executorLabel ? <p className="wrap-anywhere text-ui-caption text-(--ui-text-secondary)">{executorLabel}</p> : null}</div>
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
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {snapshot.stopped ? t("Pending jobs are kept") : t("Drafts are never sent. Only content you approve and active rules can send.")}
      </p>
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
              disabled={socialLocked || !!pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("Content I approve and active rules may send from my real accounts.")}
          </label>
          <Button
            variant="primary"
            type="button"
            loading={pendingUi.is("sending.enable")}
            disabled={socialLocked || !confirmed || !snapshot.hostOnline || !!pending}
            onClick={() =>
              void pendingUi.run("sending.enable", () =>
                execute(
                  "enable",
                  () => client.request("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" }),
                  t("Approved sends enabled. Drafts still need separate approval."),
                ),
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
          loading={pendingUi.is("sending.resume")}
          disabled={socialLocked || !snapshot.hostOnline || !!pending}
          onClick={() =>
            void pendingUi.run("sending.resume", () =>
              execute(
                "stop",
                () => client.request("execution.stop", { stopped: !snapshot.stopped }),
                snapshot.stopped ? t("Sending resumed.") : t("All sending stopped."),
              ),
            )
          }
        >
          {snapshot.stopped ? t("Resume sending") : t("Stop all sending")}
        </Button>
      </div>
    </section>
  );
}
