import { useRef, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { openExternal } from "../../../platform/tauri/openExternal";
import { useT } from "../../../shared/i18n";
import type {
  LiveGamesObsSetupOptions,
  LiveGamesStatus,
} from "../../../shared/model/host-contracts/live-games";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { StatusText } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { Copy, ExternalLink, MonitorSmartphone } from "../../../shared/ui/icons";
import type {
  LiveGamesAccountsQuery,
  LiveGamesFeedback,
  LiveGamesLiveQuery,
} from "../hooks/useLiveGames";
import { liveGamesRequest } from "../model/liveGamesClient";
import { overlayLink } from "../model/overlayLink";
import { LiveStreamControls } from "./LiveStreamControls";

const aspects = [
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
];

export function ObsControls({
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
  const [draft, setDraft] = useState<LiveGamesObsSetupOptions>();
  const options = draft ?? {
    aspect: status.obs.aspect,
    clean: status.obs.clean,
    mute: status.obs.mute,
  };
  const url = overlayLink(status.overlayUrl, options);
  const [linkResult, setLinkResult] = useState<{
    url: string;
    kind: "copy" | "preview";
    state: "pending" | "done" | "error";
  }>();
  const linkState = linkResult?.url === url ? linkResult : undefined;
  const linkAction = async (kind: "copy" | "preview") => {
    if (!url) return;
    setLinkResult({ url, kind, state: "pending" });
    try {
      if (kind === "copy") await copyText(url);
      else await openExternal(url);
      setLinkResult({ url, kind, state: "done" });
    } catch {
      setLinkResult({ url, kind, state: "error" });
    }
  };
  const operationError = feedback.error("obs-setup", "obs-scene", "obs-start", "obs-stop");
  const setupPending = feedback.pending("obs-setup");
  const linkPending = linkResult?.state === "pending";
  const managed =
    live.data?.canStop || live.data?.state === "starting" || live.data?.state === "stopping";

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t("Overlay and OBS")}>
      <SectionLabel>{t("Overlay and OBS")}</SectionLabel>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl
          label={t("Overlay aspect ratio")}
          options={
            setupPending ? aspects.map((option) => ({ ...option, disabled: true })) : aspects
          }
          value={options.aspect ?? "9:16"}
          onValueChange={(value) =>
            setDraft({ ...options, aspect: value === "16:9" ? "16:9" : "9:16" })
          }
          size="sm"
        />
        <Checkbox
          label={t("Clean mode")}
          checked={!!options.clean}
          disabled={setupPending}
          onChange={(event) => setDraft({ ...options, clean: event.target.checked })}
        />
        <Checkbox
          label={t("Mute")}
          checked={!!options.mute}
          disabled={setupPending}
          onChange={(event) => setDraft({ ...options, mute: event.target.checked })}
        />
      </div>
      {url ? (
        <TextField label={t("Overlay URL")} value={url} readOnly />
      ) : (
        <InlineError>{t("The local overlay URL is unavailable.")}</InlineError>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          startIcon={<Copy />}
          disabled={!url || linkPending}
          loading={linkState?.kind === "copy" && linkPending}
          success={linkState?.kind === "copy" && linkState.state === "done"}
          successLabel={t("Copied")}
          onClick={() => {
            void linkAction("copy").catch(() => undefined);
          }}
        >
          {t("Copy URL")}
        </Button>
        <Button
          variant="secondary"
          startIcon={<ExternalLink />}
          disabled={!url || linkPending}
          loading={linkState?.kind === "preview" && linkPending}
          onClick={() => {
            void linkAction("preview").catch(() => undefined);
          }}
        >
          {t("Preview")}
        </Button>
      </div>
      {linkState?.state === "error" ? (
        <InlineError>
          {linkState.kind === "copy"
            ? t("Could not copy the overlay URL")
            : t("Could not open the overlay")}
        </InlineError>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusText
          tone={
            status.obs.streaming && !managed ? "done" : status.obs.configured ? "idle" : "needs-you"
          }
        >
          {status.obs.streaming && !managed
            ? t("OBS streaming")
            : status.obs.configured
              ? t("OBS configured")
              : t("OBS not configured")}
        </StatusText>
        {status.obs.scene ? (
          <Text size="caption" tone="secondary">
            {status.obs.scene}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          startIcon={<MonitorSmartphone />}
          disabled={feedback.busy || managed || !url}
          loading={setupPending}
          success={feedback.succeeded("obs-setup")}
          successLabel={t("Scene saved")}
          onClick={() =>
            feedback.run({
              action: "obs-setup",
              request: () => liveGamesRequest("liveGames.obsSetup", options),
              applied: () => setDraft(undefined),
            })
          }
        >
          {status.obs.configured ? t("Update OBS scene") : t("Set up OBS")}
        </Button>
        <Button
          variant="secondary"
          disabled={feedback.busy || managed || !status.obs.configured}
          loading={feedback.pending("obs-scene")}
          onClick={() =>
            feedback.run({
              action: "obs-scene",
              request: () => liveGamesRequest("liveGames.obsScene", {}),
            })
          }
        >
          {t("Switch to Halay")}
        </Button>
      </div>
      {operationError ? (
        <InlineError details={operationError}>{t("Could not control OBS")}</InlineError>
      ) : null}
      <LiveStreamControls obs={status.obs} live={live} accounts={accounts} feedback={feedback} />
      <LiveGameCredentials feedback={feedback} status={status} streamLocked={Boolean(managed)} />
    </section>
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
