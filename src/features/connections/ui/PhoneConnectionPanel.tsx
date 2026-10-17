import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
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
  const ordered = [...machines].sort(
    (a, b) => Number(isLocalSyncMachine(b)) - Number(isLocalSyncMachine(a)),
  );
  const machine = ordered[0];

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-stroke bg-(--ui-surface-raised) p-4"
      aria-label={t("Connect your phone")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Internet className="size-5 shrink-0 text-(--ui-text-muted)" />
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-[14px] font-medium text-content">{t("Connect your phone")}</h2>
          <p className="mbs-1 text-[13px] leading-relaxed text-(--ui-text-muted)">
            {t("Scan a QR code to manage your computers from your phone.")}
          </p>
        </div>
        <Button
          type="button"

          disabled={!machine || loading || !loaded}
          onClick={() => {
            if (machine) void coordinator.open(machine);
          }}
          variant="secondary"
        >
          {t("Connect your phone")}
        </Button>
      </div>
      {machine ? (
        <p className="text-[12px] text-(--ui-text-muted)">
          {t("Pairing target: {p0}. You can choose another computer in the pairing screen.", {
            p0: isLocalSyncMachine(machine) ? t("This computer") : machine.name,
          })}
        </p>
      ) : null}
      {loaded && !loading && !machine ? (
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-(--ui-text-muted)">
          <p>
            {t(
              "Your local host is not connected yet. Check again after bycoda finishes starting, or add a computer below.",
            )}
          </p>
          <SecondaryButton onClick={() => void onRefresh()}>{t("Check again")}</SecondaryButton>
        </div>
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
    </section>
  );
}
