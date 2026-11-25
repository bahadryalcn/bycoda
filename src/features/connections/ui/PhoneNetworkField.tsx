import { t } from "../../../shared/i18n";
import { Field } from "../../../shared/ui/Field";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { publicPhoneEndpoint } from "../model/publicPhoneAccess";
import type { PhonePairingMode } from "../model/phonePairingTypes";
import type { RemoteMachine } from "../model/protocol";
import { useTunnelSession } from "./useTunnelSession";

/**
 * Which network a phone pairs over. The public internet is offered only while the owner allows
 * phones over public tunnels and this computer's Host has a live public tunnel; mount it keyed by
 * machine so the tunnel status never crosses hosts.
 */
export function PhoneNetworkField({
  machine,
  mode,
  qr,
  onMode,
}: {
  machine: RemoteMachine;
  mode: PhonePairingMode;
  /** A code is showing: the description gives way to it. */
  qr: boolean;
  onMode?: (mode: PhonePairingMode) => void;
}) {
  const { overview } = useTunnelSession(machine, true);
  // The selected choice stays listed while its tunnel goes away, so the group never loses its value.
  const publicOption = publicPhoneEndpoint(overview) !== undefined || mode === "public";
  return (
    <Field
      label={t("Phone network")}
      description={
        qr
          ? undefined
          : mode === "lan"
            ? t("Your phone and this computer must be on the same Wi-Fi or local network.")
            : mode === "tailscale"
              ? t(
                  "Only devices signed in to the same Tailscale network can connect. This computer is never reachable from the public internet.",
                )
              : t(
                  "Your phone connects through this computer's public tunnel. Anyone on the internet can reach that address.",
                )
      }
    >
      <div className="flex">
        <RadioGroup
          variant="inline"
          label={t("Phone network")}
          value={mode}
          options={[
            { value: "lan", label: t("Same Wi-Fi") },
            { value: "tailscale", label: t("Tailscale (private)") },
            ...(publicOption ? [{ value: "public", label: t("Public internet") }] : []),
          ]}
          onValueChange={(value) => onMode?.(value as PhonePairingMode)}
        />
      </div>
    </Field>
  );
}
