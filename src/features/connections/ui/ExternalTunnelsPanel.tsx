import { Alert } from "../../../shared/ui/Alert";
import "./connections-settings.css";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { t, useLocale } from "../../../shared/i18n";
import { copyText } from "../../../platform/tauri/clipboard";
import { Modal } from "../../../shared/ui/Modal";
import { Internet, Copy, Loader } from "../../../shared/ui/icons";
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
    void coordinator.open(machine);
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
          type="button"
          className="shrink-0"
          disabled={copied === "pending"}
          onClick={() => void copy()}
        >
          <Copy className="icon-sm" aria-hidden />
          {t("Copy URL")}
        </Button>
        <Button type="button" className="shrink-0" onClick={() => setQr(true)}>
          {t("Show QR code")}
        </Button>
        {tunnel.target === "host" ? (
          <Button type="button" className="shrink-0" onClick={() => setPair(true)}>
            {t("Connect your phone")}
          </Button>
        ) : null}
      </div>
      {copied === "done" ? (
        <p role="status">{t("URL copied")}</p>
      ) : copied === "error" ? (
        <Alert role="alert" tone="danger">
          {t("The URL could not be copied. Try again.")}
        </Alert>
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
  useEffect(() => {
    controller.activate();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (fresh = false) => {
      if (disposed) return;
      if (!document.hidden || fresh) await controller.refresh(fresh);
      if (!disposed) timer = setTimeout(() => void poll(), 3_000);
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
      <details className="connection-disclosure">
        <summary>{t("Tunnel setup")}</summary>
        <p className="external-tunnel-machine">{t("Tunnel runs on: {p0}", { p0: machineLabel })}</p>
        <p>
          {t(
            "Provider CLI and authentication must be available on the selected computer. Local URLs and ports refer to that computer.",
          )}
        </p>
      </details>
      <div className="external-tunnel-actions">
        <Button
          type="button"
          className="shrink-0"
          disabled={state.pending}
          onClick={() => void controller.refresh(true)}
        >
          {t("Check again")}
        </Button>
        {state.phase === "loading" || state.pending ? (
          <span role="status" className="inline-flex items-center gap-2">
            <Loader className="icon-sm motion-safe:animate-spin" aria-hidden />
            {state.pending ? t("Working…") : t("Checking tunnel access…")}
          </span>
        ) : null}
      </div>
      {state.issue ? (
        <Alert role="alert" tone="danger">
          {t(issueCopy[state.issue])}
        </Alert>
      ) : null}
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
        <SegmentedControl
          label={t("Tunnel target")}
          value={target}
          onValueChange={(value) => {
            if (!state.pending) setTarget(value as TunnelTarget);
          }}
          options={[
            { value: "dev-server", label: t("Dev server sharing") },
            { value: "host", label: t("bycoda host access") },
          ]}
        />
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
            : t(
                "Anyone with the public URL can reach this dev server. Use the server's own access controls.",
              )}
        </p>
        <Button
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
        <p role="status">
          {t("Install {p0} on {p1}, then check again.", {
            p0: provider === "cloudflare" ? "cloudflared" : "ngrok",
            p1: machineLabel,
          })}
        </p>
      ) : null}
      {provider === "cloudflare" ? (
        <p>
          {t(
            "Cloudflare Quick Tunnels need no account. URLs are temporary and SSE is not supported.",
          )}
        </p>
      ) : (
        <div className="external-tunnel-credentials">
          <p role="status">
            {t(
              selected?.credential === "saved"
                ? "ngrok authtoken is saved securely on this computer."
                : selected?.credential === "unavailable"
                  ? issueCopy["credential-store-unavailable"]
                  : issueCopy["credential-missing"],
            )}
          </p>
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
            <Button type="submit" disabled={!ready || !token} variant="primary">
              {t("Save token securely")}
            </Button>
            {selected?.credential === "saved" ? (
              <Button
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
      )}
      <div className="external-tunnel-list" aria-label={t("Tunnel status")}>
        {overview?.tunnels.length === 0 ? <p>{t("No tunnels on this computer.")}</p> : null}
        {[...(overview?.tunnels ?? [])].reverse().map((tunnel) => (
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
              <p role={tunnel.state === "error" ? "alert" : "status"}>
                {t(issueCopy[tunnel.issue])}
              </p>
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
    <section
      className="external-tunnels-panel rounded-xl border border-stroke bg-(--ui-surface) p-4"
      aria-label={t("External tunnels")}
    >
      <div className="external-tunnel-actions">
        <Internet className="icon-lg shrink-0 text-(--ui-text-muted)" aria-hidden />
        <div>
          <h2 className="text-ui-body font-medium text-content">{t("External tunnels")}</h2>
          <p>{t("Share a dev server or connect to a bycoda host through ngrok or Cloudflare.")}</p>
        </div>
      </div>
      <label htmlFor={`${id}-machine`}>
        {t("Computer")}
        <NativeSearchableSelect
          label={t("Computer")}
          id={`${id}-machine`}
          value={machine?.id ?? ""}
          disabled={!loaded || loading}
          onChange={(event) => setSelected(event.target.value)}
          options={[
            ...(!machine ? [{ value: "", label: t("Choose a computer") }] : []),
            ...ordered.map((entry) => ({
              value: entry.id,
              label: isLocalSyncMachine(entry) ? t("This computer") : entry.name,
            })),
          ]}
        />
      </label>
      {!loaded || loading ? (
        <p role="status">{t("Checking tunnel access…")}</p>
      ) : machine ? (
        <TunnelControls key={`${machine.id}:${machine.environmentId}`} machine={machine} />
      ) : (
        <p role="status">{t("Choose a connected computer to manage its tunnels.")}</p>
      )}
    </section>
  );
}
