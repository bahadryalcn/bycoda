import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import "./phone-pairing.css";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Divider } from "../../../shared/ui/Divider";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { openExternal } from "../../../platform/tauri/openExternal";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { watchPairingView } from "../../account";
import { t, useLocale } from "../../../shared/i18n";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { ModalActions, ModalFooter } from "../../../shared/ui/Modal";
import { CheckCircle, Copy, ExternalLink, RefreshCw } from "../../../shared/ui/icons";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { copyText } from "../../../platform/tauri/clipboard";
import { isLocalSyncMachine } from "../model/localSync";
import { PhoneNetworkField } from "./PhoneNetworkField";
import type {
  PhonePairingFlowProps,
  PhonePairingLinkProps,
  PhonePairingLinkStatus,
} from "../model/phonePairingTypes";

/** Copies the pairing code for the phone's "Paste pairing code", for when the camera cannot scan. */
function CopyPairingCode({ text }: { text: string }) {
  const copyFeedback = useCopyFeedback();
  return (
    <>
      <Button
        stableWidth
        type="button"
        className="shrink-0"
        disabled={copyFeedback.pending}
        success={copyFeedback.copied}
        successLabel={t("Code copied")}
        onClick={() => copyFeedback.copy(() => copyText(text))}
      >
        <Copy className="icon-sm" aria-hidden />
        {t("Copy code")}
      </Button>
      {copyFeedback.failed ? (
        <InlineMessage tone="danger">{t("The code could not be copied. Try again.")}</InlineMessage>
      ) : null}
    </>
  );
}

function PhonePairingLink({ url, label }: PhonePairingLinkProps) {
  const [status, setStatus] = useState<PhonePairingLinkStatus>("idle");
  const running = useRef(false);
  const open = async () => {
    if (running.current) return;
    running.current = true;
    setStatus("pending");
    try {
      await openExternal(url);
      setStatus("idle");
    } catch {
      setStatus("error");
    } finally {
      running.current = false;
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        stableWidth
        type="button"
        className="shrink-0"
        loading={status === "pending"}
        startIcon={<ExternalLink className="icon-sm" />}
        onClick={() => void open()}
      >
        {label}
      </Button>
      {status === "error" ? (
        <Alert tone="danger">{t("The browser could not be opened. Try again.")}</Alert>
      ) : null}
    </div>
  );
}

/**
 * The phone pairing steps, shared by the inline Phone tab and the pairing dialog so both show
 * the same access checks, QR code and paired states. In the inline variant `children` are extra
 * option rows listed under the same divider as the local network switch.
 */
export function PhonePairingFlow({
  variant,
  machines,
  state,
  onSelect,
  onMode,
  onClose,
  onRefresh,
  onEnable,
  onDisable,
  onCreate,
  onRegenerate,
  children,
}: PhonePairingFlowProps) {
  useLocale();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps account mailbox discovery responsive while pairing controls are mounted.
  useEffect(watchPairingView, []);
  const [address, setAddress] = useState("");
  const inline = variant === "inline";
  const mode = state.mode === "tailscale" || state.mode === "public" ? state.mode : "lan";
  // The LAN and Tailscale choices are this Host's encrypted phone listener (Tailscale bound to this
  // computer's tailnet address only). The public choice is the Host's live public tunnel.
  const lanCopy = {
    label: t("Local network access"),
    setup: t(
      "Your phone connects while it is on the same Wi-Fi as this computer. Pairing and workspace data are encrypted.",
    ),
    unavailable: t(
      "Local network access is unavailable. Check your computer's network and firewall, then try again.",
    ),
    help: t(
      "Keep your phone on the same local network as this computer. Allow local network access when your phone asks.",
    ),
    address: t("Local network address"),
  };
  const copy =
    mode === "lan"
      ? lanCopy
      : mode === "tailscale"
        ? {
            label: t("Tailscale (private) access"),
            setup: t(
              "Your phone connects from anywhere through your Tailscale network. Only devices in it can reach this computer, never the public internet.",
            ),
            unavailable: t(
              "Tailscale is not connected on this computer. Install Tailscale and sign in on this computer and your phone, then check again.",
            ),
            help: t(
              "Sign in to the same Tailscale network on your phone. Only devices on that network can connect.",
            ),
            address: t("Tailscale address"),
          }
        : {
            ...lanCopy,
            unavailable: t(
              "No public tunnel is ready. Allow phones over the public internet and start a public Host tunnel, then check again.",
            ),
            help: t(
              "Anyone on the internet can reach this address. Use it only away from your own networks.",
            ),
          };
  const publicWarning = t(
    "Public internet: anyone can reach this address, and the phone is protected only by this one-time code and its device credential. Use it only away from your own networks.",
  );
  const busy = ["checking", "enabling", "creating"].includes(state.stage);
  // The QR and the copied code carry the same text; the phone reads either.
  const codeText = state.stage === "qr" ? JSON.stringify(state.session.code) : "";
  const interfaces = (state.stage === "access" && state.access.addressInterfaces) || {};
  const networkHint = state.stage === "access" ? state.access.networkHint : undefined;
  const addresses = state.stage === "access" ? (state.access.addresses ?? []) : [];
  const selectedAddress = addresses.includes(address) ? address : (addresses[0] ?? "");
  // Turning a listener off acts at once: turning it on again is one click.
  const listenerToggle =
    mode !== "public" &&
    (state.stage === "qr" || (state.stage === "access" && state.access.state === "ready")) ? (
      <Switch checked onCheckedChange={() => onDisable?.()} label={copy.label} />
    ) : null;
  const showCode = (
    <Button stableWidth type="button" onClick={onCreate} variant="primary">
      {t("Show QR code")}
    </Button>
  );
  // Choosing the network already says how the phone connects: one action opens the listener and
  // shows the code, with no separate switch to find first.
  const turnOn = (
    <Button
      stableWidth
      type="button"
      onClick={() => onEnable(addresses.includes(address) ? address : undefined)}
      variant="primary"
    >
      {t("Turn on and show QR code")}
    </Button>
  );
  const primary = (action: ReactNode) =>
    inline ? (
      <div className="self-start">{action}</div>
    ) : (
      <ModalFooter>
        <ModalActions>{action}</ModalActions>
      </ModalFooter>
    );

  return (
    <div
      className={inline ? "phone-pairing-content phone-pairing-inline" : "phone-pairing-content"}
    >
      {machines.length > 1 ? (
        <SearchableSelect
          label={t("Computer")}
          value={state.machine.id}
          onChange={(id) => {
            const machine = machines.find((entry) => entry.id === id);
            if (machine) onSelect(machine);
          }}
          options={machines.map((machine) => ({
            value: machine.id,
            label: isLocalSyncMachine(machine) ? t("This computer") : machine.name,
          }))}
        />
      ) : null}

      <PhoneNetworkField
        key={state.machine.id}
        machine={state.machine}
        mode={mode}
        qr={state.stage === "qr"}
        onMode={onMode}
      />

      {busy ? (
        <LoadingText delay={state.stage !== "enabling" && state.stage !== "creating"}>
          {state.stage === "enabling"
            ? t("Opening phone access…")
            : state.stage === "creating"
              ? t("Creating your QR code…")
              : t("Checking phone access…")}
        </LoadingText>
      ) : null}

      {state.stage === "access" ? (
        <div className="flex flex-col gap-4">
          {/* One message per state: the first that applies. */}
          {mode === "lan" && networkHint ? (
            <InlineMessage tone="warning">{networkHint}</InlineMessage>
          ) : mode === "public" ? (
            <InlineMessage tone="warning">{publicWarning}</InlineMessage>
          ) : state.access.state === "ready" && state.access.reason ? (
            <InlineMessage tone="info">{state.access.reason}</InlineMessage>
          ) : null}
          {state.access.state === "ready" ? (
            primary(showCode)
          ) : (
            <>
              {/* The network hint above already explains a bare failure; the Host reason adds to it. */}
              {state.access.reason || !(mode === "lan" && networkHint) ? (
                <InlineMessage tone="info">
                  {state.access.reason
                    ? state.access.reason
                    : state.access.state === "setup-required"
                      ? copy.setup
                      : copy.unavailable}
                </InlineMessage>
              ) : null}
              {addresses.length > 1 ? (
                <SearchableSelect
                  label={copy.address}
                  value={selectedAddress}
                  onChange={(value) => {
                    setAddress(value);
                    // Picking an address after a failure retries on it so the Host rebinds.
                    if (state.access.state === "unavailable") onEnable(value);
                  }}
                  options={addresses.map((value) => ({
                    value,
                    label: interfaces[value] ? `${value} · ${interfaces[value]}` : value,
                  }))}
                />
              ) : null}
              {state.access.state === "setup-required" ? (
                primary(turnOn)
              ) : (
                <>
                  {/* Only a missing or broken network needs a recheck, after fixing it outside. */}
                  {mode === "tailscale" && !addresses.length ? (
                    <PhonePairingLink
                      url="https://tailscale.com/download"
                      label={t("Get Tailscale")}
                    />
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      stableWidth
                      type="button"
                      className="shrink-0"
                      onClick={addresses.length > 0 ? () => onEnable(selectedAddress) : onRefresh}
                    >
                      {t("Check again")}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      ) : null}

      {state.stage === "qr" ? (
        <div className="phone-pairing-code">
          {mode === "public" ? <InlineMessage tone="warning">{publicWarning}</InlineMessage> : null}
          <Text as="p" size="secondary" className="text-center">
            {t(
              "On your phone, open Connections and choose Scan QR code. Without a camera, copy the code and choose Paste pairing code.",
            )}
          </Text>
          <div
            {...surfaceAttributes({ frame: "card", radius: "card", variant: "on-solid" }, "p-2")}
          >
            <QRCodeSVG
              value={codeText}
              size={260}
              marginSize={4}
              level="M"
              title={t("Scan this code in bycoda on your phone")}
              className="h-auto w-[min(260px,65vw)]"
            />
          </div>
          <Text
            as="div"
            size="secondary"
            tone="inherit"
            leading="normal"
            className="phone-pairing-instructions"
          >
            <div className="flex items-center justify-center gap-2">
              <Badge size="sm" minWidth="8ch">
                {t("{p0}s left", { p0: state.remainingSeconds })}
              </Badge>
              <InfoTooltip label={t("Connection help")}>{copy.help}</InfoTooltip>
            </div>
          </Text>
          {state.statusError ? (
            <Alert tone="danger">
              {t(
                "Connection confirmation is temporarily unavailable. The code will still expire automatically.",
              )}
            </Alert>
          ) : null}
          <div className="phone-pairing-actions">
            <CopyPairingCode key={codeText} text={codeText} />
            <Button stableWidth type="button" className="shrink-0" onClick={onRegenerate}>
              <RefreshCw className="icon-sm" aria-hidden />
              {t("Create a new code")}
            </Button>
          </div>
        </div>
      ) : null}

      {state.stage === "expired" ? (
        <div className="flex flex-col gap-3">
          <InlineMessage tone="warning">
            {t("This code has expired. Create a new one to connect your phone.")}
          </InlineMessage>
          <Button stableWidth type="button" onClick={onRegenerate} variant="secondary">
            <RefreshCw className="icon-sm" aria-hidden />
            {t("Create a new code")}
          </Button>
        </div>
      ) : null}

      {state.stage === "paired" ? (
        <div role="status" className="flex flex-col items-start gap-3">
          <Text
            as="div"
            size="body"
            tone="primary"
            weight="medium"
            className="flex items-center gap-2"
          >
            <CheckCircle className="icon-lg" tone="success" />
            {t("Your phone is connected")}
          </Text>
          {inline ? (
            <Button
              stableWidth
              type="button"
              onClick={() => onSelect(state.machine)}
              variant="secondary"
            >
              {t("Pair another phone")}
            </Button>
          ) : (
            <Button stableWidth type="button" onClick={onClose} variant="secondary">
              {t("Done")}
            </Button>
          )}
        </div>
      ) : null}

      {state.stage === "error" ? (
        <Alert tone="danger" action={{ label: t("Check again"), onClick: onRefresh }}>
          {state.error === "host-update"
            ? t("Update the host on this machine to connect your phone.")
            : state.error === "invalid-response"
              ? t(
                  "This machine returned an invalid pairing response. Check its host and try again.",
                )
              : state.error === "management-required"
                ? t("This desktop cannot manage devices on {p0}.", { p0: state.machine.name })
                : t("This machine could not be reached. Reconnect it and try again.")}
        </Alert>
      ) : null}
      {inline ? (
        <>
          <Divider />
          {listenerToggle}
          {children}
        </>
      ) : listenerToggle ? (
        <>
          <Divider />
          {listenerToggle}
        </>
      ) : null}
    </div>
  );
}
