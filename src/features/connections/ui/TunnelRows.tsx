import { Fragment, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { t } from "../../../shared/i18n";
import { copyText } from "../../../platform/tauri/clipboard";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Code } from "../../../shared/ui/Code";
import { Divider } from "../../../shared/ui/Divider";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { openExternal } from "../../../platform/tauri/openExternal";
import { Copy, ExternalLink, Globe, Server } from "../../../shared/ui/icons";
import type { ExternalTunnel } from "../../../integrations/external-tunnels";
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
  const [copied, setCopied] = useState<"idle" | "pending" | "done" | "error">("idle");
  const pending = useRef(false);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    setCopied("pending");
    try {
      await copyText(publicUrl);
      setCopied("done");
    } catch {
      setCopied("error");
    } finally {
      pending.current = false;
    }
  };
  return (
    <>
      <Button
        stableWidth
        type="button"
        className="shrink-0"
        disabled={copied === "pending"}
        onClick={() => void copy()}
      >
        <Copy className="icon-sm" aria-hidden />
        {t("Copy URL")}
      </Button>
      <Button stableWidth type="button" className="shrink-0" onClick={() => setQr(true)}>
        {t("Show QR code")}
      </Button>
      {copied === "done" ? (
        <InlineMessage tone="success" className="external-tunnel-wide">
          {t("URL copied")}
        </InlineMessage>
      ) : copied === "error" ? (
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
  return (
    <article className="external-tunnel-row">
      <TargetIcon className="icon-md" aria-hidden />
      <div className="external-tunnel-main">
        <Text weight="medium">{isHost ? t("bycoda host") : t("Dev server")}</Text>
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
      <StatusText tone={stateTone[tunnel.state]} role="status">
        {t(stateCopy[tunnel.state])}
      </StatusText>
      {publicUrl || tunnel.issue || tunnel.canStop ? (
        <div className="external-tunnel-details">
          {publicUrl ? (
            <>
              <div className="external-tunnel-actions">
                <OverflowTooltip label={publicUrl}>
                  <Text as="div" size="caption" truncate className="min-w-0 flex-1">
                    <Code>{publicUrl}</Code>
                  </Text>
                </OverflowTooltip>
              </div>
              <Text as="p" size="caption" tone="muted">
                {t("Public internet address. Anyone can reach it; device credentials protect it.")}
              </Text>
            </>
          ) : null}
          {tunnel.issue ? (
            tunnel.state === "error" ? (
              <InlineError>{t(issueCopy[tunnel.issue])}</InlineError>
            ) : (
              <InlineMessage tone="warning">{t(issueCopy[tunnel.issue])}</InlineMessage>
            )
          ) : null}
          {tunnel.issue === "approval-required" && tunnel.approvalUrl ? (
            <ApprovalAction url={tunnel.approvalUrl} />
          ) : null}
          {publicUrl || tunnel.canStop ? (
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
                  loading={state.pending && action === `stop:${tunnel.id}`}
                  onClick={() => void run(`stop:${tunnel.id}`, () => controller.stop(tunnel.id))}
                >
                  {t("Stop tunnel")}
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
