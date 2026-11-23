import { useEffect, useRef, useState } from "react";
import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import { t } from "../../../shared/i18n";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Row } from "../../../shared/ui/settings";
import { Switch } from "../../../shared/ui/Switch";
import { phonePairingApi } from "../model/phonePairingApi";
import type { RemoteMachine } from "../model/protocol";
import { errorText } from "../../../shared/lib/errors";

/**
 * This computer's local network listener for phones. Reading never enables anything;
 * turning it off acts at once, since turning it on again is one click.
 */
export function LocalNetworkAccessRow({
  machine,
  active,
}: {
  machine: RemoteMachine;
  active: boolean;
}) {
  const [status, setStatus] = useState<MobileAccessStatus>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reads the Host's network listener each time the tab shows; a late answer after unmount is dropped.
  useEffect(() => {
    alive.current = true;
    if (!active) return;
    void phonePairingApi.access(machine, "lan").then(
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
  }, [active, machine]);

  const change = async (on: boolean) => {
    setPending(true);
    setError("");
    try {
      const next = on
        ? await phonePairingApi.enable(machine, "lan")
        : await phonePairingApi.disable?.(machine);
      if (alive.current && next) setStatus(next);
    } catch (reason) {
      if (alive.current) setError(errorText(reason));
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const on = status?.state === "ready";
  const feedback = error ? (
    <InlineError>{error}</InlineError>
  ) : status?.networkHint ? (
    <InlineMessage tone="warning">{t(status.networkHint)}</InlineMessage>
  ) : status && !on && status.state !== "setup-required" && status.reason ? (
    <InlineMessage tone="neutral">{t(status.reason)}</InlineMessage>
  ) : undefined;

  return (
    <>
      <Row
        label={t("Local network access")}
        info={t(
          "Phones on the same Wi-Fi or local network can reach this computer. Pairing and workspace data are encrypted.",
        )}
        feedback={feedback}
      >
        <Switch
          checked={on}
          disabled={!status || pending}
          aria-label={t("Local network access")}
          onCheckedChange={(next) => void change(next)}
        />
      </Row>
    </>
  );
}
