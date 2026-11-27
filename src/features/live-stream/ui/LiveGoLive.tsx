import { useRef } from "react";
import { useT } from "../../../shared/i18n";
import type { LiveStreamStatus } from "../../../shared/model/host-contracts/live-stream";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { TextField } from "../../../shared/ui/TextField";
import type {
  LiveStreamAccountsQuery,
  LiveStreamFeedback,
  LiveStreamLiveQuery,
} from "../hooks/useLiveStream";
import { liveStreamRequest } from "../model/liveStreamClient";
import { LiveSection } from "./LiveSection";
import { LiveStreamControls } from "./LiveStreamControls";

/** Step 3: pick the destination, start or stop the broadcast, and keep its credentials. */
export function LiveGoLive({
  status,
  feedback,
  live,
  accounts,
}: {
  status: LiveStreamStatus;
  feedback: LiveStreamFeedback;
  live: LiveStreamLiveQuery;
  accounts: LiveStreamAccountsQuery;
}) {
  const t = useT();
  const managed =
    live.data?.canStop || live.data?.state === "starting" || live.data?.state === "stopping";
  return (
    <LiveSection step={3} title={t("Go live")}>
      <LiveStreamControls obs={status.obs} live={live} accounts={accounts} feedback={feedback} />
      <LiveStreamCredentials feedback={feedback} status={status} streamLocked={Boolean(managed)} />
    </LiveSection>
  );
}

function LiveStreamCredentials({
  status,
  feedback,
  streamLocked,
}: {
  status: LiveStreamStatus;
  feedback: LiveStreamFeedback;
  streamLocked: boolean;
}) {
  const t = useT();
  const server = useRef<HTMLInputElement>(null);
  const key = useRef<HTMLInputElement>(null);
  const euler = useRef<HTMLInputElement>(null);
  const streamPending = feedback.pending("obs-credentials");
  const eulerPending = feedback.pending("euler-key");

  const saveEuler = (value: string) => {
    feedback.run({
      action: "euler-key",
      request: () => liveStreamRequest("liveStream.eulerKey", { key: value }),
      applied: () => {
        if (euler.current) euler.current.value = "";
      },
    });
  };

  return (
    <Disclosure summary={t("Stream credentials")} variant="row">
      <div className="flex flex-col gap-3 py-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const address = server.current?.value.trim();
            const secret = key.current?.value.trim();
            if (feedback.busy || streamLocked || !address || !secret) return;
            feedback.run({
              action: "obs-credentials",
              request: () =>
                liveStreamRequest("liveStream.obsCredentials", { server: address, key: secret }),
              applied: () => {
                if (key.current) key.current.value = "";
              },
            });
          }}
        >
          <TextField
            label={t("Stream server")}
            ref={server}
            required
            placeholder="rtmps://"
            maxLength={2048}
            disabled={streamPending || streamLocked}
            autoComplete="off"
          />
          <PasswordField
            label={t("Stream key")}
            ref={key}
            required
            maxLength={2048}
            disabled={streamPending || streamLocked}
            autoComplete="off"
          />
          <div>
            <Button
              variant="secondary"
              type="submit"
              disabled={feedback.busy || streamLocked || !status.obs.configured}
              disabledReason={
                !status.obs.configured
                  ? t("Set up OBS in step 2 first.")
                  : streamLocked
                    ? t("Stop the current stream before changing its credentials.")
                    : t("Wait for the current live stream action to finish.")
              }
              loading={streamPending}
              success={feedback.succeeded("obs-credentials")}
              successLabel={t("Saved")}
            >
              {t("Save stream credentials")}
            </Button>
          </div>
          {feedback.error("obs-credentials") ? (
            <InlineError>{t("Could not save stream credentials")}</InlineError>
          ) : null}
        </form>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = euler.current?.value.trim();
            if (value && !feedback.busy) saveEuler(value);
          }}
        >
          <PasswordField
            label={t("Euler API key")}
            ref={euler}
            maxLength={512}
            required
            disabled={eulerPending}
            autoComplete="off"
            description={t("Optional key for TikTok LIVE connections.")}
            placeholder={status.eulerKeyConfigured ? t("Configured") : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="submit"
              disabled={feedback.busy}
              loading={eulerPending}
              success={feedback.succeeded("euler-key")}
              successLabel={t("Saved")}
            >
              {t("Save Euler key")}
            </Button>
            {status.eulerKeyConfigured ? (
              <Button variant="ghost" disabled={feedback.busy} onClick={() => saveEuler("")}>
                {t("Remove Euler key")}
              </Button>
            ) : null}
          </div>
          {feedback.error("euler-key") ? (
            <InlineError>{t("Could not update the Euler key")}</InlineError>
          ) : null}
        </form>
      </div>
    </Disclosure>
  );
}
