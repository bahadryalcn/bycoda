import { Fragment, useEffect, useRef, useState } from "react";
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
import { Copy, Globe, Server } from "../../../shared/ui/icons";
import type { ExternalTunnel } from "../../../integrations/external-tunnels";
import { phonePairingApi } from "../model/phonePairingApi";
import { usePhonePairing } from "../model/usePhonePairing";
import type { RemoteMachine } from "../model/protocol";
import { PhonePairingDialog } from "./PhonePairingDialog";
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

function TunnelPairing({
  machine,
  url,
  onClose,
}: {
  machine: RemoteMachine;
  url: string;
  onClose: () => void;
}) {
  // Reuse the same short-lived, owner-issued pairing ticket and redemption checks.
  const api = useRef({
    ...phonePairingApi,
    access: async () => ({ state: "ready" as const, endpoint: url }),
  }).current;
  const { state, coordinator } = usePhonePairing(api);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Opens the pairing session on the host and ticket service once for this row's dialog.
  useEffect(() => {
    // The owner already chose "Connect your phone" on the tunnel row: go straight to the QR.
    // create() does nothing unless access is ready.
    void coordinator.open(machine).then(() => coordinator.create());
  }, [coordinator, machine]);
  if (state.stage === "closed") return null;
  return (
    <PhonePairingDialog
      fixedEndpoint
      machines={[machine]}
      state={state}
      onSelect={() => {}}
      onClose={onClose}
      onRefresh={() => void coordinator.refresh()}
      onEnable={() => {}}
      onCreate={() => void coordinator.create()}
      onRegenerate={() => void coordinator.regenerate()}
    />
  );
}

/** The public URL line of a connected tunnel, with copy, QR and phone pairing actions. */
function TunnelShareActions({
  tunnel,
  machine,
  publicUrl,
}: {
  tunnel: ExternalTunnel;
  machine: RemoteMachine;
  publicUrl: string;
}) {
  const [qr, setQr] = useState(false);
  const [pair, setPair] = useState(false);
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
      {tunnel.target === "host" ? (
        <Button stableWidth type="button" className="shrink-0" onClick={() => setPair(true)}>
          {t("Connect your phone")}
        </Button>
      ) : null}
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
                  "This URL requires a paired device. Use Connect your phone to create a pairing code.",
                )}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {pair ? (
        <TunnelPairing machine={machine} url={publicUrl} onClose={() => setPair(false)} />
      ) : null}
    </>
  );
}

function TunnelRow({
  tunnel,
  machine,
  session,
  active,
}: {
  tunnel: ExternalTunnel;
  machine: RemoteMachine;
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
                {t("Public access has not been verified.")}
              </InfoPopover>
            </div>
          ) : null}
          {tunnel.issue ? (
            tunnel.state === "error" ? (
              <InlineError>{issueCopy(tunnel.issue)}</InlineError>
            ) : (
              <InlineMessage tone="warning">{issueCopy(tunnel.issue)}</InlineMessage>
            )
          ) : null}
          {publicUrl || tunnel.canStop || canCheckAgain ? (
            <div className="external-tunnel-actions">
              {publicUrl ? (
                <TunnelShareActions
                  key={`${tunnel.id}:${publicUrl}`}
                  tunnel={tunnel}
                  machine={machine}
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
  machine,
  session,
  active = true,
}: {
  machine: RemoteMachine;
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
          <TunnelRow tunnel={tunnel} machine={machine} session={session} active={active} />
        </Fragment>
      ))}
    </Surface>
  );
}
