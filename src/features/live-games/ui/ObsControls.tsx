import { useState } from "react";
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
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { StatusText } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { Copy, ExternalLink, MonitorSmartphone } from "../../../shared/ui/icons";
import type { LiveGamesFeedback, LiveGamesLiveQuery } from "../hooks/useLiveGames";
import { liveGamesRequest } from "../model/liveGamesClient";
import { overlayLink } from "../model/overlayLink";
import { LiveSection } from "./LiveSection";
import { OverlayPreview } from "./OverlayPreview";

const aspects = [
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
];

/** Step 2: overlay look, OBS scene status and the scene actions. */
export function ObsControls({
  status,
  feedback,
  live,
}: {
  status: LiveGamesStatus;
  feedback: LiveGamesFeedback;
  live: LiveGamesLiveQuery;
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
  const aspect = options.aspect === "16:9" ? "16:9" : "9:16";

  return (
    <LiveSection
      step={2}
      title={t("Scene")}
      status={
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
      }
    >
      <div className="flex min-w-0 flex-wrap items-start gap-4">
        <OverlayPreview aspect={aspect} clean={!!options.clean} snapshot={status.snapshot} />
        <div className="flex min-w-48 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SegmentedControl
              label={t("Overlay aspect ratio")}
              options={
                setupPending ? aspects.map((option) => ({ ...option, disabled: true })) : aspects
              }
              value={aspect}
              onValueChange={(value) =>
                setDraft({ ...options, aspect: value === "16:9" ? "16:9" : "9:16" })
              }
              size="sm"
            />
            <Checkbox
              label={t("Clean mode")}
              size="secondary"
              checked={!!options.clean}
              disabled={setupPending}
              onChange={(event) => setDraft({ ...options, clean: event.target.checked })}
            />
            <Checkbox
              label={t("Mute")}
              size="secondary"
              checked={!!options.mute}
              disabled={setupPending}
              onChange={(event) => setDraft({ ...options, mute: event.target.checked })}
            />
          </div>
          {status.obs.scene ? (
            <Text size="caption" tone="secondary">
              {status.obs.scene}
            </Text>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={status.obs.configured ? "secondary" : "primary"}
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
        </div>
      </div>
      {operationError ? (
        <InlineError details={operationError}>{t("Could not control OBS")}</InlineError>
      ) : null}
      <Disclosure summary={t("Overlay URL")} variant="row">
        <div className="flex flex-col gap-2 py-2">
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
        </div>
      </Disclosure>
    </LiveSection>
  );
}
