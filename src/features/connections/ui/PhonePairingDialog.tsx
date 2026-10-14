import { openUrl } from "@tauri-apps/plugin-opener";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { CheckCircle, Copy, ExternalLink, Loader } from "../../../shared/ui/icons";
import { isLocalSyncMachine } from "../model/localSync";
import type {
  PhonePairingDialogProps,
  PhonePairingLinkProps,
  PhonePairingLinkStatus,
  PhonePairingCopyProps,
  PhonePairingCopyStatus,
} from "../model/phonePairingTypes";

const primaryButton =
  "min-h-10 self-start rounded-lg bg-selection px-3 py-2 text-[13px] font-medium hover:bg-selection-hover active:bg-selection-strong focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
const methodButton =
  "min-h-11 rounded-lg border border-stroke px-3 py-2 text-[13px] font-medium active:bg-selection-strong focus-visible:outline-2 focus-visible:outline-accent [@media(hover:hover)_and_(pointer:fine)]:hover:bg-content/10";

const accessCopy = {
  "setup-required":
    "Open a private, secure connection for your phone. Other Tailscale services stay available.",
  "install-required":
    "Install Tailscale on this machine and your phone, then sign in to the same account.",
  "sign-in-required":
    "Open Tailscale on this machine and sign in to the same account as your phone.",
  offline: "Connect this machine in Tailscale, then check again.",
  "approval-required": "Tailscale needs your approval to allow secure connections on this machine.",
  "permission-required":
    "Tailscale needs permission on this machine. Check its permissions, then try again.",
  unavailable: "A secure phone address is not available on this machine yet.",
} as const;

function PhonePairingLink({ url, label }: PhonePairingLinkProps) {
  const [status, setStatus] = useState<PhonePairingLinkStatus>("idle");
  const running = useRef(false);
  const open = async () => {
    if (running.current) return;
    running.current = true;
    setStatus("pending");
    try {
      await openUrl(url);
      setStatus("idle");
    } catch {
      setStatus("error");
    } finally {
      running.current = false;
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <SecondaryButton disabled={status === "pending"} onClick={() => void open()}>
        <ExternalLink className="size-3.5" />
        {label}
      </SecondaryButton>
      {status === "error" ? (
        <p role="alert" className="text-[12px] text-danger">
          {t("The browser could not be opened. Try again.")}
        </p>
      ) : null}
    </div>
  );
}

function PhonePairingCopy({ code }: PhonePairingCopyProps) {
  const [status, setStatus] = useState<PhonePairingCopyStatus>("idle");
  const running = useRef(false);
  const copy = async () => {
    if (running.current || Date.parse(code.expiresAt) <= Date.now()) return;
    running.current = true;
    setStatus("pending");
    try {
      await copyText(JSON.stringify(code));
      setStatus("success");
    } catch {
      setStatus("error");
    } finally {
      running.current = false;
    }
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <SecondaryButton disabled={status === "pending"} onClick={() => void copy()}>
        <Copy className="size-3.5" />
        {t("Copy pairing code")}
      </SecondaryButton>
      {status === "success" ? (
        <p role="status" className="text-[12px] text-content/60">
          {t("Pairing code copied")}
        </p>
      ) : status === "error" ? (
        <p role="alert" className="text-[12px] text-danger">
          {t("The pairing code could not be copied. Try again.")}
        </p>
      ) : null}
    </div>
  );
}

export function PhonePairingDialog({
  fixedEndpoint = false,
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
}: PhonePairingDialogProps) {
  useLocale();
  const [address, setAddress] = useState("");
  const localNetwork = !fixedEndpoint && state.mode === "lan";
  const busy = ["checking", "enabling", "creating"].includes(state.stage);
  const machineLabel = isLocalSyncMachine(state.machine) ? t("This computer") : state.machine.name;

  return (
    <Modal
      title={t("Connect your phone")}
      description={t("Manage this computer from bycoda on your phone.")}
      onClose={onClose}
      size="md"
    >
      <div className="flex flex-col gap-5 p-4">
        {!fixedEndpoint ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[12px] text-content/60">{t("Connection method")}</legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={localNetwork}
                className={`${methodButton} ${localNetwork ? "bg-selection" : "bg-content/3"}`}
                onClick={() => onMode?.("lan")}
              >
                {t("Local network")}
              </button>
              <button
                type="button"
                aria-pressed={!localNetwork}
                className={`${methodButton} ${localNetwork ? "bg-content/3" : "bg-selection"}`}
                onClick={() => onMode?.("tailscale")}
              >
                {t("Tailscale")}
              </button>
            </div>
            <p className="text-[12px] leading-relaxed text-content/60">
              {localNetwork
                ? t(
                    "Connect your phone and computer to the same Wi-Fi or local network. Tailscale is not required.",
                  )
                : t("Use Tailscale to connect from another network.")}
            </p>
          </fieldset>
        ) : null}
        {machines.length > 1 ? (
          <label className="flex flex-col gap-1.5 text-[12px] text-content/60">
            {t("Computer")}
            <select
              aria-label={t("Computer")}
              className="min-h-10 w-full rounded-lg border border-content/15 bg-content/3 px-3 py-2 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-accent"
              value={state.machine.id}
              onChange={(event) => {
                const machine = machines.find((entry) => entry.id === event.target.value);
                if (machine) onSelect(machine);
              }}
            >
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {isLocalSyncMachine(machine) ? t("This computer") : machine.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-[13px] font-medium text-content">{machineLabel}</p>
        )}

        {busy ? (
          <div role="status" className="flex items-center gap-2 text-[13px] text-content/60">
            <Loader className="size-4 motion-safe:animate-spin" />
            {state.stage === "enabling"
              ? t("Opening the secure connection…")
              : state.stage === "creating"
                ? t("Creating your QR code…")
                : t("Checking phone access…")}
          </div>
        ) : null}

        {state.stage === "access" ? (
          <div className="flex flex-col gap-4">
            {state.access.state === "ready" ? (
              <>
                <p className="text-[13px] leading-relaxed text-content/60">
                  {localNetwork
                    ? t(
                        "The local network connection is ready. Create a code to connect your phone.",
                      )
                    : t("The secure connection is ready. Create a code to connect your phone.")}
                </p>
                <button type="button" className={primaryButton} onClick={onCreate}>
                  {t("Connect your phone")}
                </button>
              </>
            ) : (
              <>
                <p role="status" className="text-[13px] leading-relaxed text-content/60">
                  {localNetwork
                    ? state.access.state === "setup-required"
                      ? t(
                          "Enable local network access to connect your phone. Pairing and workspace data are encrypted.",
                        )
                      : t(
                          "Local network access is unavailable. Check your computer's network and firewall, then try again.",
                        )
                    : t(accessCopy[state.access.state])}
                </p>
                {localNetwork && (state.access.addresses?.length ?? 0) > 1 ? (
                  <label className="flex flex-col gap-2 text-[12px] text-content/60">
                    {t("Local network address")}
                    <select
                      aria-label={t("Local network address")}
                      value={
                        state.access.addresses!.includes(address)
                          ? address
                          : state.access.addresses![0]
                      }
                      onChange={(event) => setAddress(event.target.value)}
                      className="min-h-11 rounded-lg border border-stroke bg-content/3 p-2 text-content focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {state.access.addresses!.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {state.access.state === "setup-required" ? (
                  <button
                    type="button"
                    className={primaryButton}
                    onClick={() =>
                      onEnable(
                        localNetwork && state.access.addresses?.includes(address)
                          ? address
                          : undefined,
                      )
                    }
                  >
                    {localNetwork
                      ? t("Enable local network access")
                      : t("Enable secure connection")}
                  </button>
                ) : null}
                {state.access.state === "install-required" ? (
                  <PhonePairingLink
                    url="https://tailscale.com/download"
                    label={t("Get Tailscale")}
                  />
                ) : null}
                {state.access.state === "approval-required" && state.access.approvalUrl ? (
                  <PhonePairingLink
                    url={state.access.approvalUrl}
                    label={t("Allow secure connections")}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {state.access.state === "permission-required" ? (
                    <SecondaryButton onClick={() => onEnable()}>
                      {t("Retry secure connection")}
                    </SecondaryButton>
                  ) : null}
                  <SecondaryButton onClick={onRefresh}>{t("Check again")}</SecondaryButton>
                </div>
              </>
            )}
          </div>
        ) : null}

        {state.stage === "qr" ? (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border border-stroke bg-on-solid p-2">
              <QRCodeSVG
                value={JSON.stringify(state.session.code)}
                size={260}
                marginSize={4}
                level="M"
                title={t("Scan this code in bycoda on your phone")}
                className="h-auto w-[min(260px,65vw)]"
              />
            </div>
            <div className="flex flex-col gap-2 text-center text-[13px] leading-relaxed">
              <p className="font-medium text-content">
                {t("Scan this code in bycoda on your phone")}
              </p>
              <p className="text-content/60">
                {t("On your phone, open Connections and choose Scan QR code.")}
              </p>
              <p className="text-[12px] text-content/50">
                {localNetwork
                  ? t(
                      "Keep your phone on the same local network as this computer. Allow local network access when your phone asks.",
                    )
                  : t("Use the same Tailscale account on this machine and your phone.")}
              </p>
              <p className="tabular-nums text-[12px] text-content/50">
                {t("Code expires in {p0} seconds", {
                  p0: state.remainingSeconds,
                })}
              </p>
            </div>
            {state.statusError ? (
              <p role="alert" className="text-[12px] text-warning">
                {t(
                  "Connection confirmation is temporarily unavailable. The code will still expire automatically.",
                )}
              </p>
            ) : null}
            <PhonePairingCopy key={state.session.pairingId} code={state.session.code} />
            <SecondaryButton onClick={onRegenerate}>{t("Create a new code")}</SecondaryButton>
          </div>
        ) : null}

        {state.stage === "expired" ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-[13px] text-content/60">
              {t("This code has expired. Create a new one to connect your phone.")}
            </p>
            <button type="button" className={primaryButton} onClick={onRegenerate}>
              {t("Create a new code")}
            </button>
          </div>
        ) : null}

        {state.stage === "paired" ? (
          <div role="status" className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2 text-[14px] font-medium text-content">
              <CheckCircle className="size-5 text-success" />
              {t("Your phone is connected")}
            </div>
            <p className="text-[13px] leading-relaxed text-content/60">
              {state.deviceName
                ? t("{p0} can now manage {p1}.", {
                    p0: state.deviceName,
                    p1: machineLabel,
                  })
                : t("You can now manage {p0} from your phone.", {
                    p0: machineLabel,
                  })}
            </p>
            <button type="button" className={primaryButton} onClick={onClose}>
              {t("Done")}
            </button>
          </div>
        ) : null}

        {state.stage === "error" ? (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-[13px] leading-relaxed text-danger">
              {state.error === "host-update"
                ? t("Update the host on this machine to connect your phone.")
                : state.error === "invalid-response"
                  ? t(
                      "This machine returned an invalid pairing response. Check its host and try again.",
                    )
                  : t("This machine could not be reached. Reconnect it and try again.")}
            </p>
            <SecondaryButton onClick={onRefresh}>{t("Check again")}</SecondaryButton>
          </div>
        ) : null}
        {localNetwork &&
        (state.stage === "qr" || (state.stage === "access" && state.access.state === "ready")) ? (
          <SecondaryButton onClick={onDisable}>
            {t("Turn off local network access")}
          </SecondaryButton>
        ) : null}
      </div>
    </Modal>
  );
}
