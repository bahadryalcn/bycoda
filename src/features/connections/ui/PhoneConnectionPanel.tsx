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
      className="flex flex-col gap-3 rounded-xl border border-stroke bg-content/3 p-4"
      aria-label={t("Connect your phone")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Internet className="size-5 shrink-0 text-content/60" />
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-[14px] font-medium text-content">{t("Connect your phone")}</h2>
          <p className="mbs-1 text-[13px] leading-relaxed text-content/55">
            {t("Scan a QR code to manage your computers from your phone.")}
          </p>
        </div>
        <button
          type="button"
          className="min-h-10 rounded-lg bg-selection px-3 py-2 text-[13px] font-medium hover:bg-selection-hover active:bg-selection-strong focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
          disabled={!machine || loading || !loaded}
          onClick={() => {
            if (machine) void coordinator.open(machine);
          }}
        >
          {t("Connect your phone")}
        </button>
      </div>
      {loaded && !loading && !machine ? (
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-content/55">
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
