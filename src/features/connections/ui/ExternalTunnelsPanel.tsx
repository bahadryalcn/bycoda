import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { t, useLocale } from "../../../shared/i18n";
import { copyText } from "../../../platform/tauri/clipboard";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
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
        <SecondaryButton disabled={copied === "pending"} onClick={() => void copy()}>
          <Copy className="size-3.5" aria-hidden />
          {t("Copy URL")}
        </SecondaryButton>
        <SecondaryButton onClick={() => setQr(true)}>{t("Show QR code")}</SecondaryButton>
        {tunnel.target === "host" ? (
          <SecondaryButton onClick={() => setPair(true)}>{t("Connect your phone")}</SecondaryButton>
        ) : null}
      </div>
      {copied === "done" ? (
        <p role="status">{t("URL copied")}</p>
      ) : copied === "error" ? (
        <p role="alert">{t("The URL could not be copied. Try again.")}</p>
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
      <p className="external-tunnel-machine">{t("Tunnel runs on: {p0}", { p0: machineLabel })}</p>
      <p>
        {t(
          "Provider CLI and authentication must be available on the selected computer. Local URLs and ports refer to that computer.",
        )}
      </p>
      <div className="external-tunnel-actions">
        <SecondaryButton disabled={state.pending} onClick={() => void controller.refresh(true)}>
          {t("Check again")}
        </SecondaryButton>
        {state.phase === "loading" || state.pending ? (
          <span role="status" className="inline-flex items-center gap-2">
            <Loader className="size-3.5 motion-safe:animate-spin" aria-hidden />
            {state.pending ? t("Working…") : t("Checking tunnel access…")}
          </span>
        ) : null}
      </div>
      {state.issue ? <p role="alert">{t(issueCopy[state.issue])}</p> : null}
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
        <label htmlFor={`${id}-provider`}>
          {t("Tunnel provider")}
          <select
            id={`${id}-provider`}
            value={provider}
            disabled={state.pending}
            onChange={(event) => setProvider(event.target.value as TunnelProvider)}
          >
            <option value="cloudflare">Cloudflare</option>
            <option value="ngrok">ngrok</option>
          </select>
        </label>
        <label htmlFor={`${id}-target`}>
          {t("Tunnel target")}
          <select
            id={`${id}-target`}
            value={target}
            disabled={state.pending}
            onChange={(event) => setTarget(event.target.value as TunnelTarget)}
          >
            <option value="dev-server">{t("Dev server sharing")}</option>
            <option value="host">{t("bycoda host access")}</option>
          </select>
        </label>
        <label htmlFor={`${id}-url`} className="external-tunnel-wide">
          {t("Local URL or port on the selected computer")}
          <input
            id={`${id}-url`}
            value={target === "host" ? (overview?.hostLocalUrl ?? "") : localUrl}
            readOnly={target === "host"}
            disabled={state.pending}
            placeholder="http://127.0.0.1:3000"
            onChange={(event) => setLocalUrl(event.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <p className="external-tunnel-wide">
          {target === "host"
            ? t(
                "Host access keeps device authentication and pairing. The public URL contains no device credential.",
              )
            : t(
                "Anyone with the public URL can reach this dev server. Use the server's own access controls.",
              )}
        </p>
        <button
          type="submit"
          className="external-tunnel-primary"
          disabled={
            !ready ||
            !selected?.installed ||
            (provider === "ngrok" && selected.credential !== "saved")
          }
        >
          {t("Start tunnel")}
        </button>
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
            <label htmlFor={`${id}-token`}>
              {t("ngrok authtoken")}
              <input
                id={`${id}-token`}
                type="password"
                value={token}
                disabled={state.pending}
                autoComplete="new-password"
                spellCheck={false}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <button type="submit" className="external-tunnel-primary" disabled={!ready || !token}>
              {t("Save token securely")}
            </button>
            {selected?.credential === "saved" ? (
              <SecondaryButton disabled={!ready} onClick={() => void controller.credential("")}>
                {t("Forget saved token")}
              </SecondaryButton>
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
              <span role="status">{t(stateCopy[tunnel.state])}</span>
              {tunnel.canStop ? (
                <SecondaryButton
                  disabled={state.pending || tunnel.state === "stopping"}
                  onClick={() => void controller.stop(tunnel.id)}
                >
                  {t("Stop tunnel")}
                </SecondaryButton>
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
      className="external-tunnels-panel rounded-xl border border-stroke bg-content/3 p-4"
      aria-label={t("External tunnels")}
    >
      <div className="external-tunnel-actions">
        <Internet className="size-5 shrink-0 text-content/60" aria-hidden />
        <div>
          <h2 className="text-[14px] font-medium text-content">{t("External tunnels")}</h2>
          <p>{t("Share a dev server or connect to a bycoda host through ngrok or Cloudflare.")}</p>
        </div>
      </div>
      <label htmlFor={`${id}-machine`}>
        {t("Computer")}
        <select
          id={`${id}-machine`}
          value={machine?.id ?? ""}
          disabled={!loaded || loading}
          onChange={(event) => setSelected(event.target.value)}
        >
          {!machine ? <option value="">{t("Choose a computer")}</option> : null}
          {ordered.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {isLocalSyncMachine(entry) ? t("This computer") : entry.name}
            </option>
          ))}
        </select>
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
