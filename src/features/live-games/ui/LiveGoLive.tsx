import { useRef } from "react";
import { useT } from "../../../shared/i18n";
import type { LiveGamesStatus } from "../../../shared/model/host-contracts/live-games";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { TextField } from "../../../shared/ui/TextField";
import type {
  LiveGamesAccountsQuery,
  LiveGamesFeedback,
  LiveGamesLiveQuery,
} from "../hooks/useLiveGames";
import { liveGamesRequest } from "../model/liveGamesClient";
import { LiveSection } from "./LiveSection";
import { LiveStreamControls } from "./LiveStreamControls";

/** Step 3: pick the destination, start or stop the broadcast, and keep its credentials. */
export function LiveGoLive({
  status,
  feedback,
  live,
  accounts,
}: {
  status: LiveGamesStatus;
  feedback: LiveGamesFeedback;
  live: LiveGamesLiveQuery;
  accounts: LiveGamesAccountsQuery;
}) {
  const t = useT();
  const managed =
    live.data?.canStop || live.data?.state === "starting" || live.data?.state === "stopping";
  return (
    <LiveSection step={3} title={t("Go live")}>
      <LiveStreamControls obs={status.obs} live={live} accounts={accounts} feedback={feedback} />
      <LiveGameCredentials feedback={feedback} status={status} streamLocked={Boolean(managed)} />
    </LiveSection>
  );
}

function LiveGameCredentials({
  status,
  feedback,
  streamLocked,
}: {
  status: LiveGamesStatus;
  feedback: LiveGamesFeedback;
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
      request: () => liveGamesRequest("liveGames.eulerKey", { key: value }),
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
                liveGamesRequest("liveGames.obsCredentials", { server: address, key: secret }),
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
