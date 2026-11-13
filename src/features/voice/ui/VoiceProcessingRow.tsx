import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { t } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Segmented } from "../../settings/public/settingsControls";
import type { VoiceDevice } from "../model/localVoiceClient";
import type { VoiceSettings } from "../model/voiceSettings";
import type { VoiceSetup } from "./useVoiceSetup";
type Change = (patch: Partial<VoiceSettings>) => void;

export function ProcessingRow({
  id,
  setup,
  value,
  change,
}: {
  id: string;
  setup: VoiceSetup;
  value: VoiceDevice;
  change: Change;
}) {
  return (
    <Row
      id={id}
      label={t("Processing")}
      info={
        <InfoPopover label={`${t("Processing")}: ${t("Help")}`}>
          {t("Automatic uses a supported NVIDIA GPU when available.")}
        </InfoPopover>
      }
      disabled={setup.installing}
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
