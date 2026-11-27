import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { t } from "../../../shared/i18n";
import { Segmented, SettingsFeedback } from "../../../shared/ui/settings";
import type { VoiceDevice } from "../model/localVoiceClient";
import type { VoiceSettings } from "../model/voiceSettings";
import type { VoiceSetup } from "./useVoiceSetup";
type Change = (patch: Partial<VoiceSettings>) => void;

/** The one Processing choice (Automatic, GPU, CPU) shared by voice replies and local dictation. */
export function ProcessingRow({
  setup,
  value,
  change,
}: {
  setup: VoiceSetup;
  value: VoiceDevice;
  change: Change;
}) {
  return (
    <Row
      id="voice-device"
      label={t("Processing")}
      description={t("Automatic uses a supported NVIDIA GPU when available.")}
      disabled={setup.installing}
      modified={!setup.installing && value !== "auto"}
      onReset={() => {
        setup.resetJob();
        change({ device: "auto" });
      }}
      feedback={
        setup.gpuUnavailable ? (
          <SettingsFeedback
            state="warning"
            action={{
              label: t("Use automatic selection"),
              onClick: () => {
                setup.resetJob();
                change({ device: "auto" });
              },
            }}
          >
            {t("No supported NVIDIA GPU was found.")}
          </SettingsFeedback>
        ) : undefined
      }
    >
      <Segmented
        label={t("Processing")}
        value={value}
        options={[
          { value: "auto", label: t("Automatic") },
          { value: "gpu", label: t("GPU") },
          { value: "cpu", label: t("CPU") },
        ]}
        onChange={(next) => {
          setup.resetJob();
          change({ device: next as VoiceDevice });
        }}
      />
    </Row>
  );
}
