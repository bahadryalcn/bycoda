import { Field } from "../../../shared/ui/Field";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Surface } from "../../../shared/ui/Surface";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { t, useLocale } from "../../../shared/i18n";
import { copyText } from "../../../platform/tauri/clipboard";
import { Modal } from "../../../shared/ui/Modal";
import { Copy, RefreshCw } from "../../../shared/ui/icons";
import type {
  ExternalTunnel,
  TunnelProvider,
  TunnelTarget,
} from "../../../integrations/external-tunnels";
import {
  externalTunnelApi,
  ExternalTunnelController,
  type TunnelUiIssue,
} from "../model/externalTunnelController";
import { isLocalSyncMachine } from "../model/localSync";
import { remoteBackoffDelay } from "../model/remotePollingPolicy";
import type { RemoteMachine } from "../model/protocol";
import { phonePairingApi } from "../model/phonePairingApi";
import { usePhonePairing } from "../model/usePhonePairing";
import { PhonePairingDialog } from "./PhonePairingDialog";
import "./external-tunnels.css";

const issueCopy: Record<TunnelUiIssue, string> = {
  "cli-missing":
    "The tunnel CLI is missing on this computer. Install the selected provider and check again.",
  "credential-missing": "ngrok needs a valid authtoken. Save one for this computer and try again.",
  "credential-store-unavailable":
    "The secure credential store is unavailable. Unlock it on this computer and try again.",
  "invalid-target": "Enter a loopback HTTP or HTTPS URL, or a port from 1 to 65535.",
  "host-target-required": "This is the bycoda host port. Select bycoda host access to share it.",
  "origin-unreachable":
    "The local service is not listening on this computer. Start it or check the URL and port.",
  "connection-failed":
    "The tunnel provider could not connect. Check this computer's internet connection and provider account.",
  "startup-timeout": "The tunnel did not connect in time. Check the network and try again.",
  "unexpected-exit":
    "The tunnel process closed unexpectedly. Its public URL is no longer available. Start a new tunnel.",
  "process-error": "The tunnel process could not start. Check the provider CLI on this computer.",
  "stop-failed": "The tunnel process did not stop. Retry stopping it on this computer.",
  "host-restarted":
    "The host restarted. This previous tunnel is interrupted. Start a new tunnel to get a new URL.",
  "storage-unavailable":
    "Tunnel state could not be read or saved. Check the host's data directory permissions.",
  "host-update": "Update bycoda Host on this computer to manage external tunnels.",
  connection: "The selected computer could not be reached. Reconnect it and check again.",
  "invalid-response":
    "The host returned an invalid tunnel status. Check the selected computer and update its host.",
};
const stateCopy = {
  starting: "Starting",
  ready: "Connected",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
  interrupted: "Interrupted",
};
const stateTone: Record<keyof typeof stateCopy, BadgeTone> = {
  starting: "info",
  ready: "success",
  stopping: "warning",
  stopped: "neutral",
  error: "danger",
  interrupted: "warning",
};
const providerName = (provider: TunnelProvider) => (provider === "ngrok" ? "ngrok" : "Cloudflare");

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

function TunnelUrl({ tunnel, machine }: { tunnel: ExternalTunnel; machine: RemoteMachine }) {
  const [qr, setQr] = useState(false);
  const [pair, setPair] = useState(false);
  const [copied, setCopied] = useState<"idle" | "pending" | "done" | "error">("idle");
  const pending = useRef(false);
  const copy = async () => {
    if (pending.current || !tunnel.publicUrl) return;
    pending.current = true;
    setCopied("pending");
    try {
      await copyText(tunnel.publicUrl);
      setCopied("done");
    } catch {
      setCopied("error");
    } finally {
      pending.current = false;
    }
  };
  if (!tunnel.publicUrl) return null;
  return (
    <div className="external-tunnel-url">
      <code>{tunnel.publicUrl}</code>
      <div className="external-tunnel-actions">
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
        {tunnel.target === "host" ? (
          <Button stableWidth type="button" className="shrink-0" onClick={() => setPair(true)}>
            {t("Connect your phone")}
          </Button>
        ) : null}
      </div>
      {copied === "done" ? (
        <InlineMessage tone="success">{t("URL copied")}</InlineMessage>
      ) : copied === "error" ? (
        <Alert tone="danger">{t("The URL could not be copied. Try again.")}</Alert>
      ) : null}
      <p>{t("Public access has not been verified.")}</p>
      {qr ? (
        <Modal title={t("Tunnel QR code")} size="sm" onClose={() => setQr(false)}>
          <div className="external-tunnel-qr">
            <QRCodeSVG value={tunnel.publicUrl} size={240} marginSize={4} title={t("Tunnel URL")} />
            <code>{tunnel.publicUrl}</code>
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
        <TunnelPairing machine={machine} url={tunnel.publicUrl} onClose={() => setPair(false)} />
      ) : null}
    </div>
  );
}

/** Keyed by machine identity at each entry point, so responses cannot cross hosts. */
export function TunnelControls({
  machine,
  initialLocalUrl = "3000",
}: {
  machine: RemoteMachine;
  initialLocalUrl?: string;
}) {
  useLocale();
  const id = useId();
  const controllerRef = useRef<ExternalTunnelController | null>(null);
  if (!controllerRef.current)
    controllerRef.current = new ExternalTunnelController(
      machine.environmentId,
      externalTunnelApi(machine),
    );
  const controller = controllerRef.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [provider, setProvider] = useState<TunnelProvider>("cloudflare");
  const [target, setTarget] = useState<TunnelTarget>("dev-server");
  const [localUrl, setLocalUrl] = useState(initialLocalUrl);
  const [token, setToken] = useState("");
  const [repairNoticeDismissed, setRepairNoticeDismissed] = useState(false);
  useEffect(() => {
    controller.activate();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    // Consecutive failed reads lengthen the wait, as the other machine pollers do.
    let failures = 0;
    const poll = async (fresh = false) => {
      if (disposed) return;
      if (!document.hidden || fresh) {
        await controller.refresh(fresh);
        failures = controller.getSnapshot().phase === "error" ? failures + 1 : 0;
      }
      if (!disposed)
        timer = setTimeout(() => void poll(), failures ? remoteBackoffDelay(failures) : 3_000);
    };
    void poll(true);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.close();
    };
  }, [controller]);
  const overview = state.overview;
  const selected = overview?.providers.find((entry) => entry.provider === provider);
  const ready = state.phase === "ready" && !state.pending;
  const machineLabel = isLocalSyncMachine(machine) ? t("This computer") : machine.name;
  return (
    <div
      className="external-tunnel-controls"
      aria-busy={state.pending || state.phase === "loading"}
    >
      {overview?.tunnels.length ? (
        <div className="external-tunnel-list" aria-label={t("Tunnel status")}>
          {[...overview.tunnels].reverse().map((tunnel) => (
            <article key={tunnel.id} className="external-tunnel-item">
              <div className="external-tunnel-actions">
                <strong>
                  {providerName(tunnel.provider)} ·{" "}
                  {t(tunnel.target === "host" ? "bycoda host access" : "Dev server sharing")}
                </strong>
                <Badge variant="dot" size="sm" tone={stateTone[tunnel.state]} role="status">
                  {t(stateCopy[tunnel.state])}
                </Badge>
                {tunnel.canStop ? (
                  <Button
                    stableWidth
                    type="button"
                    className="shrink-0"
                    disabled={state.pending || tunnel.state === "stopping"}
                    onClick={() => void controller.stop(tunnel.id)}
                  >
                    {t("Stop tunnel")}
                  </Button>
                ) : null}
              </div>
              <code>{tunnel.localUrl}</code>
              {tunnel.issue ? (
                tunnel.state === "error" ? (
                  <InlineError>{t(issueCopy[tunnel.issue])}</InlineError>
                ) : (
                  <InlineMessage tone="warning">{t(issueCopy[tunnel.issue])}</InlineMessage>
                )
              ) : null}
              {ready && tunnel.state === "ready" ? (
                <TunnelUrl
                  key={`${tunnel.id}:${tunnel.publicUrl}`}
                  tunnel={tunnel}
                  machine={machine}
                />
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {overview?.repair && !repairNoticeDismissed ? (
        <Alert tone="info" onDismiss={() => setRepairNoticeDismissed(true)}>
          {t("Tunnel settings were damaged and repaired; {p0} entries could not be recovered.", {
            p0: String(overview.repair.dropped),
          })}
        </Alert>
      ) : null}
      {state.issue ? <Alert tone="danger">{t(issueCopy[state.issue])}</Alert> : null}
      <form
        className="external-tunnel-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            ready &&
            selected?.installed &&
            (provider === "cloudflare" || selected.credential === "saved")
          )
            void controller.start({
              provider,
              target,
              ...(target === "dev-server" ? { localUrl } : {}),
            });
        }}
      >
        <Field label={t("What to share")}>
          <SegmentedControl
            label={t("Tunnel target")}
            value={target}
            onValueChange={(value) => {
              if (!state.pending) setTarget(value as TunnelTarget);
            }}
            options={[
              { value: "dev-server", label: t("Dev server") },
              { value: "host", label: t("bycoda host") },
            ]}
          />
        </Field>
        <Field label={t("Provider")}>
          <SegmentedControl
            label={t("Tunnel provider")}
            value={provider}
            onValueChange={(value) => {
              if (!state.pending) setProvider(value as TunnelProvider);
            }}
            options={[
              { value: "cloudflare", label: "Cloudflare" },
              { value: "ngrok", label: "ngrok" },
            ]}
          />
        </Field>
        <div className="external-tunnel-actions external-tunnel-wide">
          <Badge variant="dot" tone={selected?.installed ? "success" : "neutral"}>
            {t(selected?.installed ? "{p0} CLI ready" : "{p0} CLI needed", {
              p0: provider === "cloudflare" ? "Cloudflare" : "ngrok",
            })}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            label={t("Check again")}
            disabled={state.pending}
            onClick={() => void controller.refresh(true)}
          >
            <RefreshCw className="icon-sm" aria-hidden />
          </Button>
          {state.phase === "loading" || state.pending ? (
            <LoadingText delay={!state.pending}>
              {state.pending ? t("Working…") : t("Checking tunnel access…")}
            </LoadingText>
          ) : null}
          <InfoPopover label={t("Tunnel setup")}>
            <p>
              {t(
                "Provider CLI and authentication must be available on the selected computer. Local URLs and ports refer to that computer.",
              )}
            </p>
            {provider === "cloudflare" ? (
              <p>
                {t(
                  "Cloudflare Quick Tunnels need no account. URLs are temporary and SSE is not supported.",
                )}
              </p>
            ) : null}
          </InfoPopover>
        </div>
        <TextField
          label={t("Local URL or port")}
          id={`${id}-url`}
          value={target === "host" ? (overview?.hostLocalUrl ?? "") : localUrl}
          readOnly={target === "host"}
          disabled={state.pending}
          placeholder="http://127.0.0.1:3000"
          onChange={(event) => setLocalUrl(event.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          fieldClassName="min-w-0 flex-1"
        />
        <p className="external-tunnel-wide">
          {target === "host"
            ? t(
                "Host access keeps device authentication and pairing. The public URL contains no device credential.",
              )
            : t("Anyone with this URL can reach the dev server. Keep access controls enabled.")}
        </p>
        <Button
          stableWidth
          type="submit"
          disabled={
            !ready ||
            !selected?.installed ||
            (provider === "ngrok" && selected.credential !== "saved")
          }
          variant="primary"
        >
          {t("Start tunnel")}
        </Button>
      </form>
      {selected && !selected.installed ? (
        <InlineMessage tone="warning">
          {t("Install {p0} on {p1}, then check again.", {
            p0: provider === "cloudflare" ? "cloudflared" : "ngrok",
            p1: machineLabel,
          })}
        </InlineMessage>
      ) : null}
      {provider === "ngrok" ? (
        <div className="external-tunnel-credentials">
          <InlineMessage tone={selected?.credential === "saved" ? "success" : "warning"}>
            {t(
              selected?.credential === "saved"
                ? "ngrok authtoken is saved securely on this computer."
                : selected?.credential === "unavailable"
                  ? issueCopy["credential-store-unavailable"]
                  : issueCopy["credential-missing"],
            )}
          </InlineMessage>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && token) {
                const value = token;
                setToken("");
                void controller.credential(value);
              }
            }}
          >
            <PasswordField
              label={t("ngrok authtoken")}
              id={`${id}-token`}

              value={token}
              disabled={state.pending}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => setToken(event.target.value)}
              fieldClassName="min-w-0 flex-1"
            />
            <Button stableWidth type="submit" disabled={!ready || !token} variant="primary">
              {t("Save token securely")}
            </Button>
            {selected?.credential === "saved" ? (
              <Button
                stableWidth
                type="button"
                className="shrink-0"
                disabled={!ready}
                onClick={() => void controller.credential("")}
              >
                {t("Forget saved token")}
              </Button>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function ExternalTunnelsPanel({
  machines,
  loaded,
  loading,
}: {
  machines: RemoteMachine[];
  loaded: boolean;
  loading: boolean;
}) {
  useLocale();
  const [selected, setSelected] = useState("");
  const id = useId();
  const ordered = [...machines].sort(
    (a, b) => Number(isLocalSyncMachine(b)) - Number(isLocalSyncMachine(a)),
  );
  const machine = selected ? ordered.find((entry) => entry.id === selected) : ordered[0];
  return (
    <Surface
      as="section"
      variant="outline"
      padding="lg"
      className="external-tunnels-panel"
      aria-label={t("External tunnels")}
    >
      <p>
        {t(
          "Share a dev server or this computer's bycoda host through a public Cloudflare or ngrok URL.",
        )}
      </p>
      {ordered.length > 1 ? (
        <SearchableSelect
          label={t("Computer")}
          triggerProps={{ id: `${id}-machine` }}
          value={machine?.id ?? ""}
          disabled={!loaded || loading}
          onChange={setSelected}
          options={ordered.map((entry) => ({
            value: entry.id,
            label: isLocalSyncMachine(entry) ? t("This computer") : entry.name,
          }))}
        />
      ) : null}
      {!loaded || loading ? (
        <LoadingText>{t("Checking tunnel access…")}</LoadingText>
      ) : machine ? (
        <TunnelControls key={`${machine.id}:${machine.environmentId}`} machine={machine} />
      ) : (
        <EmptyState
          size="inline"
          kind="empty"
          description={t("Choose a connected computer to manage its tunnels.")}
        />
      )}
    </Surface>
  );
}
