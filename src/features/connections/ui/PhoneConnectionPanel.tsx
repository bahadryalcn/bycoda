import { useSyncExternalStore } from "react";
import { Button } from "../../../shared/ui/Button";
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
import { Internet } from "../../../shared/ui/icons";
import { isLocalSyncMachine } from "../model/localSync";
import type { PhoneConnectionPanelProps } from "../model/phonePairingTypes";
import { usePhonePairing } from "../model/usePhonePairing";
import { PhonePairingDialog } from "./PhonePairingDialog";

export function PhoneConnectionPanel({
  machines,
  loaded,
  loading,
  onRefresh,
}: PhoneConnectionPanelProps) {
  useLocale();
  const { state, coordinator } = usePhonePairing();
  const signedIn = isSignedIn(useAccountState());
  const accountConnect = useSyncExternalStore(subscribePhoneConnect, isPhoneConnectEnabled);
  const ordered = [...machines].sort(
    (a, b) => Number(isLocalSyncMachine(b)) - Number(isLocalSyncMachine(a)),
  );
  const machine = ordered[0];

  return (
    <Surface
      as="section"
      variant="outline"
      padding="lg"
      className="flex flex-col gap-3"
      aria-label={t("Connect your phone")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Internet className="icon-lg shrink-0 text-(--ui-text-muted)" />
        <div className="min-w-0 flex-1 basis-48">
          <p className="mbs-1 text-ui-secondary leading-relaxed text-(--ui-text-muted)">
            {t("Scan a QR code to manage your computers from your phone.")}
          </p>
        </div>
        <Button
          type="button"

          disabled={!machine || loading || !loaded}
          onClick={() => {
            if (machine) void coordinator.open(machine);
          }}
          variant="primary"
        >
          {t("Connect your phone")}
        </Button>
      </div>
      <Switch
        checked={accountConnect && signedIn}
        disabled={!signedIn}
        onCheckedChange={setPhoneConnectEnabled}
        label={t("Let my signed-in phones find this computer")}
        description={t(
          "Phones signed in to your account can ask to connect, and you approve each one here. Needs bycoda open and your account signed in; route addresses are stored in your account.",
        )}
      />
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
      {state.stage !== "closed" ? (
        <PhonePairingDialog
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
        />
      ) : null}
    </Surface>
  );
}
