import { Fragment, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { t } from "../../../shared/i18n";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { copyText } from "../../../platform/tauri/clipboard";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Code } from "../../../shared/ui/Code";
import { Divider } from "../../../shared/ui/Divider";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { openExternal } from "../../../platform/tauri/openExternal";
import { Copy, ExternalLink, Globe, Server } from "../../../shared/ui/icons";
import type { ExternalTunnel } from "../../../integrations/external-tunnels";
import { LiveText } from "../../../shared/ui/LiveText";
import { issueCopy, providerName, stateCopy } from "./tunnelCopy";
import type { TunnelSession } from "./useTunnelSession";

const stateTone: Record<ExternalTunnel["state"], StatusTextTone> = {
  starting: "running",
  ready: "done",
  stopping: "running",
  stopped: "idle",
  error: "failed",
  interrupted: "needs-you",
};

/** The public URL line of a connected tunnel, with copy and QR actions. */
function TunnelShareActions({ tunnel, publicUrl }: { tunnel: ExternalTunnel; publicUrl: string }) {
  const [qr, setQr] = useState(false);
  // The confirmation clears itself and resets when the URL changes.
  const copyFeedback = useCopyFeedback({ resetKeys: [publicUrl] });
  return (
    <>
      <Button
        stableWidth
        type="button"
        className="shrink-0"
        disabled={copyFeedback.pending}
        onClick={() => copyFeedback.copy(() => copyText(publicUrl))}
      >
        <Copy className="icon-sm" aria-hidden />
        {t("Copy URL")}
      </Button>
      <Button stableWidth type="button" className="shrink-0" onClick={() => setQr(true)}>
        {t("Show QR code")}
      </Button>
      {copyFeedback.copied ? (
        <InlineMessage tone="success" className="external-tunnel-wide">
          {t("URL copied")}
        </InlineMessage>
      ) : copyFeedback.failed ? (
        <Alert tone="danger" className="external-tunnel-wide">
          {t("The URL could not be copied. Try again.")}
        </Alert>
      ) : null}
      {qr ? (
        <Modal title={t("Tunnel QR code")} size="sm" onClose={() => setQr(false)}>
          <div className="external-tunnel-qr">
            <QRCodeSVG
              {...surfaceAttributes({ radius: "panel" })}
              value={publicUrl}
              size={240}
              marginSize={4}
              title={t("Tunnel URL")}
            />
            <Text as="span" size="caption" leading="inherit">
              <Code>{publicUrl}</Code>
            </Text>
            {tunnel.target === "host" ? (
              <p>
                {t(
                  "This URL is for other computers. Phones can use a public tunnel only when public phone access is allowed in Devices.",
                )}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Opens the validated Tailscale admin page where Funnel is enabled. */
function ApprovalAction({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="external-tunnel-actions">
      <Button
        stableWidth
        type="button"
        className="shrink-0"
        onClick={() =>
          void openExternal(url).then(
            () => setFailed(false),
            () => setFailed(true),
          )
        }
      >
        <ExternalLink className="icon-sm" aria-hidden />
        {t("Open approval page")}
      </Button>
      {failed ? (
        <InlineError>{t("The browser could not be opened. Try again.")}</InlineError>
      ) : null}
    </div>
  );
}

function TunnelRow({
  tunnel,
  session,
  active,
}: {
  tunnel: ExternalTunnel;
  session: TunnelSession;
  active: boolean;
}) {
  const { controller, state, action, run, ready } = session;
  const publicUrl = active && ready && tunnel.state === "ready" ? tunnel.publicUrl : undefined;
  const isHost = tunnel.target === "host";
  const TargetIcon = isHost ? Server : Globe;
  const canCheckAgain = tunnel.state === "error" && !tunnel.canStop;
  return (
    <article className="external-tunnel-row">
      <TargetIcon className="icon-md" aria-hidden />
      <div className="external-tunnel-main">
        <Text weight="medium">{isHost ? t("Remote access") : t("Web app")}</Text>
        <div className="external-tunnel-meta">
          <Text as="span" size="caption" tone="muted">
            {providerName(tunnel.provider)}
          </Text>
          {isHost ? null : (
            <Text as="span" size="caption" tone="secondary" truncate className="min-w-0">
              <Code>{tunnel.localUrl}</Code>
            </Text>
          )}
        </div>
      </div>
      <StatusText tone={stateTone[tunnel.state]}>
        <LiveText text={stateCopy(tunnel.state)} />
      </StatusText>
      {publicUrl || tunnel.issue || tunnel.canStop || canCheckAgain ? (
        <div className="external-tunnel-details">
          {publicUrl ? (
            <div className="external-tunnel-actions">
              <OverflowTooltip label={publicUrl}>
                <Text as="div" size="caption" truncate className="min-w-0 flex-1">
                  <Code>{publicUrl}</Code>
                </Text>
              </OverflowTooltip>
              <InfoPopover label={t("Public URL")}>
                {t("Public internet address. Anyone can reach it; device credentials protect it.")}
              </InfoPopover>
            </div>
          ) : null}
          {tunnel.issue ? (
            tunnel.state === "error" ? (
              <InlineError>{issueCopy(tunnel.issue, session.remoteName)}</InlineError>
            ) : (
              <InlineMessage tone="warning">
                {issueCopy(tunnel.issue, session.remoteName)}
              </InlineMessage>
            )
          ) : null}
          {tunnel.issue === "approval-required" && tunnel.approvalUrl ? (
            <ApprovalAction url={tunnel.approvalUrl} />
          ) : null}
          {publicUrl || tunnel.canStop || canCheckAgain ? (
            <div className="external-tunnel-actions">
              {publicUrl ? (
                <TunnelShareActions
                  key={`${tunnel.id}:${publicUrl}`}
                  tunnel={tunnel}
                  publicUrl={publicUrl}
                />
              ) : null}
              {tunnel.canStop ? (
                <Button
                  stableWidth
                  type="button"
                  className="shrink-0"
                  disabled={state.pending || tunnel.state === "stopping"}
                  disabledReason={
                    state.pending || tunnel.state === "stopping"
                      ? t("Wait for the current action to finish.")
                      : undefined
                  }
                  loading={state.pending && action === `stop:${tunnel.id}`}
                  onClick={() => void run(`stop:${tunnel.id}`, () => controller.stop(tunnel.id))}
                >
                  {t("Stop tunnel")}
                </Button>
              ) : null}
              {canCheckAgain ? (
                <Button
                  stableWidth
                  type="button"
                  className="shrink-0"
                  disabled={state.pending}
                  onClick={() => void controller.refresh(true)}
                >
                  {t("Check again")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Every tunnel the machine reports, newest first, in one divided card. */
export function TunnelRows({
  session,
  active = true,
}: {
  session: TunnelSession;
  active?: boolean;
}) {
  const tunnels = session.overview?.tunnels;
  if (!tunnels?.length) return null;
  return (
    <Surface as="section" variant="card" padding="none" aria-label={t("Tunnel status")}>
      {[...tunnels].reverse().map((tunnel, index) => (
        <Fragment key={tunnel.id}>
          {index ? <Divider /> : null}
          <TunnelRow tunnel={tunnel} session={session} active={active} />
        </Fragment>
      ))}
    </Surface>
  );
}
