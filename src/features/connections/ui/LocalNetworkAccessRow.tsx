import { useEffect, useRef, useState } from "react";
import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import { t } from "../../../shared/i18n";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Row } from "../../../shared/ui/settings";
import { Switch } from "../../../shared/ui/Switch";
import { phonePairingApi } from "../model/phonePairingApi";
import type { RemoteMachine } from "../model/protocol";
import { errorText } from "../../../shared/lib/errors";

/**
 * One of this computer's phone listeners: the local network one, or the Tailscale one, which
 * is bound to this computer's tailnet address only. Reading never enables anything; turning
 * it off asks first because phones on that network lose access.
 */
export function LocalNetworkAccessRow({
  machine,
  active,
  mode = "lan",
}: {
  machine: RemoteMachine;
  active: boolean;
  mode?: "lan" | "tailscale";
}) {
  const lan = mode === "lan";
  const label = lan ? t("Local network access") : t("Tailscale (private)");
  const [status, setStatus] = useState<MobileAccessStatus>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const alive = useRef(true);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reads the Host's network listener each time the tab shows; a late answer after unmount is dropped.
  useEffect(() => {
    alive.current = true;
    if (!active) return;
    void phonePairingApi.access(machine, mode).then(
      (next) => {
        if (alive.current) setStatus(next);
      },
      () => {
        if (alive.current) setStatus({ state: "unavailable" });
      },
    );
    return () => {
      alive.current = false;
    };
  }, [active, machine, mode]);

  const change = async (on: boolean) => {
    setPending(true);
    setError("");
    try {
      const next = on
        ? await phonePairingApi.enable(machine, mode)
        : await phonePairingApi.disable?.(machine, mode);
      if (alive.current && next) setStatus(next);
    } catch (reason) {
      if (alive.current) setError(errorText(reason));
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const on = status?.state === "ready";
  // No tailnet address means Tailscale is not running or signed in on this computer.
  const noTailnet = !lan && status?.state === "unavailable" && !status.addresses?.length;
  const feedback = error ? (
    <InlineError>{error}</InlineError>
  ) : status?.networkHint ? (
    <InlineMessage tone="warning">{t(status.networkHint)}</InlineMessage>
  ) : noTailnet ? (
    <InlineMessage tone="neutral">
      {t(
        "Tailscale is not connected on this computer. Install Tailscale and sign in, then check again.",
      )}
    </InlineMessage>
  ) : status && !on && status.state !== "setup-required" && status.reason ? (
    <InlineMessage tone="neutral">{t(status.reason)}</InlineMessage>
  ) : undefined;

  return (
    <>
      <Row
        label={label}
        info={
          lan
            ? t(
                "Phones on the same Wi-Fi or local network can reach this computer. Pairing and workspace data are encrypted.",
              )
            : t(
                "Only devices signed in to the same Tailscale network can connect. This computer is never reachable from the public internet.",
              )
        }
        feedback={feedback}
      >
        <Switch
          checked={on}
          disabled={!status || pending || noTailnet}
          aria-label={label}
          onCheckedChange={(next) => (next ? void change(true) : setConfirmOff(true))}
        />
      </Row>
      {confirmOff ? (
        <ConfirmDialog
          request={{
            title: lan ? t("Turn off local network access?") : t("Turn off Tailscale access?"),
            message: lan
              ? t("Phones on this network will lose access to this computer.")
              : t("Phones on your Tailscale network will lose access to this computer."),
            confirmLabel: lan ? t("Turn off local network access") : t("Turn off Tailscale access"),
          }}
          onSettle={(confirmed) => {
            setConfirmOff(false);
            if (confirmed) void change(false);
          }}
        />
      ) : null}
    </>
  );
}
