import { Alert } from "../../../shared/ui/Alert";
import "./phone-pairing.css";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Divider } from "../../../shared/ui/Divider";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Field } from "../../../shared/ui/Field";
import { Switch } from "../../../shared/ui/Switch";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { openExternal } from "../../../platform/tauri/openExternal";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { t, useLocale } from "../../../shared/i18n";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { CheckCircle, Copy, ExternalLink, RefreshCw } from "../../../shared/ui/icons";
import { isLocalSyncMachine } from "../model/localSync";
import type {
  PhonePairingFlowProps,
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
        disabled={status === "pending"}
        onClick={() => void open()}
      >
        <ExternalLink className="icon-sm" />
        {label}
      </Button>
      {status === "error" ? (
        <Alert tone="danger">{t("The browser could not be opened. Try again.")}</Alert>
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
      <Button
        stableWidth
        type="button"
        className="shrink-0"
        disabled={status === "pending"}
        onClick={() => void copy()}
      >
        <Copy className="icon-sm" />
        {t("Copy pairing code")}
      </Button>
      {status === "success" ? (
        <InlineMessage tone="success">{t("Pairing code copied")}</InlineMessage>
      ) : status === "error" ? (
        <Alert tone="danger">{t("The pairing code could not be copied. Try again.")}</Alert>
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
  children,
}: PhonePairingFlowProps) {
  useLocale();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [address, setAddress] = useState("");
  const inline = variant === "inline";
  const localNetwork = !fixedEndpoint && state.mode === "lan";
  const busy = ["checking", "enabling", "creating"].includes(state.stage);
  const machineLabel = isLocalSyncMachine(state.machine) ? t("This computer") : state.machine.name;
  const localToggle =
    localNetwork &&
    (state.stage === "qr" || (state.stage === "access" && state.access.state === "ready")) ? (
      <Switch
        checked
        onCheckedChange={() => setConfirmDisable(true)}
        label={t("Local network access")}
      />
    ) : null;

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
      ) : inline ? null : (
        <p className="text-ui-secondary font-medium text-content">{machineLabel}</p>
      )}

      {!fixedEndpoint ? (
        <Field
          label={t("Phone network")}
          description={
            state.stage === "qr"
              ? undefined
              : localNetwork
                ? t("Your phone and this computer must be on the same Wi-Fi or local network.")
                : t(
                    "Works from any network. Tailscale must be signed in to the same account on this computer and your phone.",
                  )
          }
        >
          <div className="flex">
            <SegmentedControl
              label={t("Phone network")}
              value={localNetwork ? "lan" : "tailscale"}
              options={[
                { value: "lan", label: t("Same Wi-Fi") },
                { value: "tailscale", label: t("Anywhere (Tailscale)") },
              ]}
              onValueChange={(value) => onMode?.(value as "lan" | "tailscale")}
            />
          </div>
        </Field>
      ) : null}

      {busy ? (
        <LoadingText delay={state.stage !== "enabling" && state.stage !== "creating"}>
          {state.stage === "enabling"
            ? t("Opening the secure connection…")
            : state.stage === "creating"
              ? t("Creating your QR code…")
              : t("Checking phone access…")}
        </LoadingText>
      ) : null}

      {state.stage === "access" ? (
        <div className="flex flex-col gap-4">
          {localNetwork && state.access.reason ? (
            <InlineMessage tone="info">{t(state.access.reason)}</InlineMessage>
          ) : null}
          {state.access.state === "ready" ? (
            <Button
              stableWidth
              type="button"
              className={inline ? "self-start" : undefined}
              onClick={onCreate}
              variant="primary"
            >
              {t("Show QR code")}
            </Button>
          ) : (
            <>
              <InlineMessage tone="info">
                {localNetwork
                  ? state.access.state === "setup-required"
                    ? t(
                        "Enable local network access to connect your phone. Pairing and workspace data are encrypted.",
                      )
                    : t(
                        "Local network access is unavailable. Check your computer's network and firewall, then try again.",
                      )
                  : t(accessCopy[state.access.state])}
              </InlineMessage>
              {localNetwork && (state.access.addresses?.length ?? 0) > 1 ? (
                <SearchableSelect
                  label={t("Local network address")}
                  value={
                    state.access.addresses!.includes(address) ? address : state.access.addresses![0]
                  }
                  onChange={setAddress}
                  options={state.access.addresses!.map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              ) : null}
              {state.access.state === "setup-required" && localNetwork ? (
                <Switch
                  checked={false}
                  onCheckedChange={() =>
                    onEnable(state.access.addresses?.includes(address) ? address : undefined)
                  }
                  label={t("Local network access")}
                />
              ) : state.access.state === "setup-required" ? (
                <Button stableWidth type="button" onClick={() => onEnable()} variant="secondary">
                  {t("Enable secure connection")}
                </Button>
              ) : null}
              {state.access.state === "install-required" ? (
                <PhonePairingLink url="https://tailscale.com/download" label={t("Get Tailscale")} />
              ) : null}
              {state.access.state === "approval-required" && state.access.approvalUrl ? (
                <PhonePairingLink
                  url={state.access.approvalUrl}
                  label={t("Allow secure connections")}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {state.access.state === "permission-required" ? (
                  <Button stableWidth type="button" className="shrink-0" onClick={() => onEnable()}>
                    {t("Retry secure connection")}
                  </Button>
                ) : null}
                <Button stableWidth type="button" className="shrink-0" onClick={onRefresh}>
                  {t("Check again")}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {state.stage === "qr" ? (
        <div className="phone-pairing-code">
          <div className="rounded-(--ui-radius-card) border border-(--ui-card-border) bg-on-solid p-2">
            <QRCodeSVG
              value={JSON.stringify(state.session.code)}
              size={260}
              marginSize={4}
              level="M"
              title={t("Scan this code in bycoda on your phone")}
              className="h-auto w-[min(260px,65vw)]"
            />
          </div>
          <div className="phone-pairing-instructions">
            <p>{t("On your phone, open Connections and choose Scan QR code.")}</p>
            <div className="flex items-center justify-center gap-2">
              <Badge size="sm" minWidth="8ch">
                {t("{p0}s left", { p0: state.remainingSeconds })}
              </Badge>
              <InfoPopover label={t("Connection help")}>
                {localNetwork
                  ? t(
                      "Keep your phone on the same local network as this computer. Allow local network access when your phone asks.",
                    )
                  : t("Use the same Tailscale account on this machine and your phone.")}
              </InfoPopover>
            </div>
          </div>
          {state.statusError ? (
            <Alert tone="danger">
              {t(
                "Connection confirmation is temporarily unavailable. The code will still expire automatically.",
              )}
            </Alert>
          ) : null}
          <div className="phone-pairing-actions">
            <PhonePairingCopy key={state.session.pairingId} code={state.session.code} />
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
          <div className="flex items-center gap-2 text-ui-body font-medium text-content">
            <CheckCircle className="icon-lg text-(--ui-tone-success-fg)" />
            {t("Your phone is connected")}
          </div>
          <p className="text-ui-secondary leading-relaxed text-(--ui-text-muted)">
            {state.deviceName
              ? t("{p0} can now manage {p1}.", {
                  p0: state.deviceName,
                  p1: machineLabel,
                })
              : t("You can now manage {p0} from your phone.", {
                  p0: machineLabel,
                })}
          </p>
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
        <div className="flex flex-col gap-3">
          <Alert tone="danger">
            {state.error === "host-update"
              ? t("Update the host on this machine to connect your phone.")
              : state.error === "invalid-response"
                ? t(
                    "This machine returned an invalid pairing response. Check its host and try again.",
                  )
                : t("This machine could not be reached. Reconnect it and try again.")}
          </Alert>
          <Button stableWidth type="button" className="shrink-0" onClick={onRefresh}>
            {t("Check again")}
          </Button>
        </div>
      ) : null}
      {inline ? (
        <>
          <Divider />
          {localToggle}
          {children}
        </>
      ) : (
        localToggle
      )}
      {confirmDisable ? (
        <ConfirmDialog
          request={{
            title: t("Turn off local network access?"),
            message: t("Phones on this network will lose access to this computer."),
            confirmLabel: t("Turn off local network access"),
          }}
          onSettle={(confirmed) => {
            setConfirmDisable(false);
            if (confirmed) onDisable?.();
          }}
        />
      ) : null}
    </div>
  );
}
