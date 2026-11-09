import { useEffect, useSyncExternalStore } from "react";
import { Switch } from "../../../shared/ui/Switch";
import {
  isPhoneConnectEnabled,
  isSignedIn,
  setPhoneConnectEnabled,
  subscribePhoneConnect,
  useAccountState,
} from "../../account";
import { t, useLocale } from "../../../shared/i18n";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Surface } from "../../../shared/ui/Surface";
import { isLocalSyncMachine } from "../model/localSync";
import type { PhoneConnectionPanelProps } from "../model/phonePairingTypes";
import { usePhonePairing } from "../model/usePhonePairing";
import { PhonePairingFlow } from "./PhonePairingFlow";

export function PhoneConnectionPanel({
  machines,
  loaded,
  loading,
  onRefresh,
  active = true,
}: PhoneConnectionPanelProps) {
  useLocale();
  const { state, coordinator } = usePhonePairing();
  const signedIn = isSignedIn(useAccountState());
  const accountConnect = useSyncExternalStore(subscribePhoneConnect, isPhoneConnectEnabled);
  const ordered = [...machines].sort(
    (a, b) => Number(isLocalSyncMachine(b)) - Number(isLocalSyncMachine(a)),
  );
  const machine = ordered[0];
  const ready = active && loaded && !loading;

  // Opening only reads access state (nothing is enabled or created). A live pairing code is
  // released as soon as the tab is left, and the flow starts over when the tab is shown again.
  useEffect(() => {
    if (!active) {
      coordinator.close();
      return;
    }
    if (ready && machine && coordinator.getSnapshot().stage === "closed")
      void coordinator.open(machine);
  }, [active, ready, machine, coordinator]);

  return (
    <Surface
      as="section"
      variant="outline"
      padding="lg"
      className="flex flex-col gap-3"
      aria-label={t("Connect your phone")}
    >
      <p className="text-ui-secondary leading-relaxed text-(--ui-text-muted)">
        {t("Scan a QR code with bycoda on your phone to manage this computer.")}
      </p>
      {state.stage !== "closed" ? (
        <PhonePairingFlow
          variant="inline"
          machines={ordered}
          state={state}
          onSelect={(selected) => void coordinator.open(selected)}
          onMode={(mode) => void coordinator.selectMode(mode)}
          onClose={coordinator.close}
          onRefresh={() => void coordinator.refresh()}
          onEnable={(address) => void coordinator.enable(address)}
          onDisable={() => void coordinator.disable()}
          onCreate={() => void coordinator.create()}
          onRegenerate={() => void coordinator.regenerate()}
        >
          <AccountConnectSwitch accountConnect={accountConnect} signedIn={signedIn} />
        </PhonePairingFlow>
      ) : (
        <AccountConnectSwitch accountConnect={accountConnect} signedIn={signedIn} />
      )}
      {loaded && !loading && !machine ? (
        <InlineMessage
          tone="neutral"
          retry={{ onRetry: () => void onRefresh(), label: t("Check again") }}
        >
          {t(
            "Your local host is not connected yet. Check again after bycoda finishes starting, or add a computer below.",
          )}
        </InlineMessage>
      ) : null}
    </Surface>
  );
}

function AccountConnectSwitch({
  accountConnect,
  signedIn,
}: {
  accountConnect: boolean;
  signedIn: boolean;
}) {
  return (
    <Switch
      checked={accountConnect && signedIn}
      disabled={!signedIn}
      onCheckedChange={setPhoneConnectEnabled}
      label={t("Let my signed-in phones find this computer")}
      description={t(
        "Phones signed in to your account can ask to connect, and you approve each one here. Needs bycoda open and your account signed in; route addresses are stored in your account.",
      )}
    />
  );
}
