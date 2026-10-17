import { Alert } from "../../../shared/ui/Alert";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
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
        <Alert role="alert" tone="danger">
          {t("The browser could not be opened. Try again.")}
        </Alert>
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
        <p role="status" className="text-[12px] text-(--ui-text-muted)">
          {t("Pairing code copied")}
        </p>
      ) : status === "error" ? (
        <Alert role="alert" tone="danger">
          {t("The pairing code could not be copied. Try again.")}
        </Alert>
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
            <legend className="text-[12px] text-(--ui-text-muted)">{t("Connection method")}</legend>
            <RadioGroup
              label={t("Connection method")}
              compact
              value={localNetwork ? "lan" : "tailscale"}
              options={[
                { value: "lan", label: t("Local network") },
                { value: "tailscale", label: t("Tailscale") },
              ]}
              onValueChange={(value) => onMode?.(value as "lan" | "tailscale")}
            />
            <p className="text-[12px] leading-relaxed text-(--ui-text-muted)">
              {localNetwork
                ? t(
                    "Connect your phone and computer to the same Wi-Fi or local network. Tailscale is not required.",
                  )
                : t("Use Tailscale to connect from another network.")}
            </p>
          </fieldset>
        ) : null}
        {machines.length > 1 ? (
          <label className="flex flex-col gap-1.5 text-[12px] text-(--ui-text-muted)">
            {t("Computer")}
            <NativeSearchableSelect
              label={t("Computer")}
              aria-label={t("Computer")}

              value={state.machine.id}
              onChange={(event) => {
                const machine = machines.find((entry) => entry.id === event.target.value);
                if (machine) onSelect(machine);
              }}
              options={machines.map((machine) => ({
                value: machine.id,
                label: isLocalSyncMachine(machine) ? t("This computer") : machine.name,
              }))}
            />
          </label>
        ) : (
          <p className="text-[13px] font-medium text-content">{machineLabel}</p>
        )}

        {busy ? (
          <div role="status" className="flex items-center gap-2 text-[13px] text-(--ui-text-muted)">
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
                <p className="text-[13px] leading-relaxed text-(--ui-text-muted)">
                  {localNetwork
                    ? t(
                        "The local network connection is ready. Create a code to connect your phone.",
                      )
                    : t("The secure connection is ready. Create a code to connect your phone.")}
                </p>
                <Button type="button" onClick={onCreate} variant="secondary">
                  {t("Connect your phone")}
                </Button>
              </>
            ) : (
              <>
                <p role="status" className="text-[13px] leading-relaxed text-(--ui-text-muted)">
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
                  <label className="flex flex-col gap-2 text-[12px] text-(--ui-text-muted)">
                    {t("Local network address")}
                    <NativeSearchableSelect
                      label={t("Local network address")}
                      aria-label={t("Local network address")}
                      value={
                        state.access.addresses!.includes(address)
                          ? address
                          : state.access.addresses![0]
                      }
                      onChange={(event) => setAddress(event.target.value)}

                      options={state.access.addresses!.map((value) => ({ value, label: value }))}
                    />
                  </label>
                ) : null}
                {state.access.state === "setup-required" ? (
                  <Button
                    type="button"

                    onClick={() =>
                      onEnable(
                        localNetwork && state.access.addresses?.includes(address)
                          ? address
                          : undefined,
                      )
                    }
                    variant="secondary"
                  >
                    {localNetwork
                      ? t("Enable local network access")
                      : t("Enable secure connection")}
                  </Button>
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
              <p className="text-(--ui-text-muted)">
                {t("On your phone, open Connections and choose Scan QR code.")}
              </p>
              <p className="text-[12px] text-(--ui-text-muted)">
                {localNetwork
                  ? t(
                      "Keep your phone on the same local network as this computer. Allow local network access when your phone asks.",
                    )
                  : t("Use the same Tailscale account on this machine and your phone.")}
              </p>
              <p className="tabular-nums text-[12px] text-(--ui-text-muted)">
                {t("Code expires in {p0} seconds", {
                  p0: state.remainingSeconds,
                })}
              </p>
            </div>
            {state.statusError ? (
              <Alert role="alert" tone="danger">
                {t(
                  "Connection confirmation is temporarily unavailable. The code will still expire automatically.",
                )}
              </Alert>
            ) : null}
            <PhonePairingCopy key={state.session.pairingId} code={state.session.code} />
            <SecondaryButton onClick={onRegenerate}>{t("Create a new code")}</SecondaryButton>
          </div>
        ) : null}

        {state.stage === "expired" ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-[13px] text-(--ui-text-muted)">
              {t("This code has expired. Create a new one to connect your phone.")}
            </p>
            <Button type="button" onClick={onRegenerate} variant="secondary">
              {t("Create a new code")}
            </Button>
          </div>
        ) : null}

        {state.stage === "paired" ? (
          <div role="status" className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2 text-[14px] font-medium text-content">
              <CheckCircle className="size-5 text-success" />
              {t("Your phone is connected")}
            </div>
            <p className="text-[13px] leading-relaxed text-(--ui-text-muted)">
              {state.deviceName
                ? t("{p0} can now manage {p1}.", {
                    p0: state.deviceName,
                    p1: machineLabel,
                  })
                : t("You can now manage {p0} from your phone.", {
                    p0: machineLabel,
                  })}
            </p>
            <Button type="button" onClick={onClose} variant="secondary">
              {t("Done")}
            </Button>
          </div>
        ) : null}

        {state.stage === "error" ? (
          <div className="flex flex-col gap-3">
            <Alert role="alert" tone="danger">
              {state.error === "host-update"
                ? t("Update the host on this machine to connect your phone.")
                : state.error === "invalid-response"
                  ? t(
                      "This machine returned an invalid pairing response. Check its host and try again.",
                    )
                  : t("This machine could not be reached. Reconnect it and try again.")}
            </Alert>
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
