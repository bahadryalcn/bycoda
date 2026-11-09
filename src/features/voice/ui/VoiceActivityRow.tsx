import { useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Row } from "../../settings/public/settingsControls";
import { useActiveDictations, type ActiveDictation } from "../model/dictationActivity";
import {
  isVoiceConversationActive,
  subscribeVoiceConversationActivity,
} from "../model/voiceActivity";
import { useDictationLabel } from "./HiddenDictationIndicator";

/**
 * Shows only what is using the microphone in this window right now. Whether
 * voice is enabled and ready is already shown by the switches and Voice setup.
 */
export function VoiceActivityRow() {
  const t = useT();
  const companion = useSyncExternalStore(
    subscribeVoiceConversationActivity,
    isVoiceConversationActive,
    () => false,
  );
  const dictations = useActiveDictations();
  if (!companion && !dictations.length) return null;
  return (
    <Row id="voice-activity" label={t("Microphone in use")}>
      <div className="flex min-w-0 flex-col items-end gap-1">
        {companion ? <ActivityLine label={t("Voice companion is connected")} /> : null}
        {dictations.map((run, index) => (
          <DictationLine key={run.sessionId ?? index} run={run} />
        ))}
      </div>
    </Row>
  );
}

function ActivityLine({ label }: { label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-ui-caption">
      <StatusDot tone="danger" appearance="solid" size="sm" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function DictationLine({ run }: { run: ActiveDictation }) {
  const t = useT();
  const { label } = useDictationLabel(run);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ActivityLine label={label} />
      <Button size="sm" disabled={run.state === "finishing"} onClick={run.stop}>
        {t("Stop dictation")}
      </Button>
    </span>
  );
}
