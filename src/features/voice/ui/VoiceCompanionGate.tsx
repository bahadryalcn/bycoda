import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Mic } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { assistantRequest, useAssistantSnapshot } from "../../assistant/model/assistantClient";
import { migrateVoiceOwnerMemory } from "../model/voiceHostMemory";
import { AssistantSetup } from "../../assistant/ui/AssistantSetup";
import { useVoiceSettings } from "../model/voiceSettings";
import { useVoiceWake } from "./useVoiceWake";
import type { VoiceCompanionProps } from "./VoiceCompanion";
import { VoiceLauncherFrame } from "./companion/VoiceLauncher";
import { useVoiceLauncherSlot } from "./companion/voiceLauncherSlot";

const Companion = lazy(() =>
  import("./VoiceCompanion").then((module) => ({ default: module.VoiceCompanion })),
);

/** Opt-in, per device. Unmounting releases voice while coding turns continue. */
export function VoiceCompanionGate(props: VoiceCompanionProps) {
  const settings = useVoiceSettings();
  const { snapshot, error, loading, refresh } = useAssistantSnapshot();
  const [setup, setSetup] = useState(false);
  const slot = useVoiceLauncherSlot();
  useEffect(() => {
    if (snapshot?.profile.setupComplete)
      void migrateVoiceOwnerMemory(snapshot, assistantRequest).catch(() => {
        /* Retry on the next owner state refresh; legacy data remains intact. */
      });
  }, [snapshot?.profile.setupComplete]);
  if (!settings.enabled) return null;
  if (!snapshot || !snapshot.profile.setupComplete || !snapshot.profile.voiceSetupComplete)
    return (
      <>
        <VoiceLauncherFrame>
          <Button
            iconOnly
            variant={slot ? "ghost" : undefined}
            label={t(error ? "Retry" : "Set up voice")}
            tooltip={error || undefined}
            loading={loading}
            onClick={() => (snapshot ? setSetup(true) : void refresh())}
          >
            <Mic className="icon-lg" />
          </Button>
        </VoiceLauncherFrame>
        {setup && snapshot ? <AssistantSetup voice onClose={() => setSetup(false)} /> : null}
      </>
    );
  return (
    <>
      <ReadyCompanion
        companion={props}
        wakeInput={{
          settings,
          profile: snapshot.profile,
          manualPresence: snapshot.presence?.state,
        }}
        onSetup={() => setSetup(true)}
      />
      {setup ? <AssistantSetup voice onClose={() => setSetup(false)} /> : null}
    </>
  );
}

function ReadyCompanion({
  companion,
  wakeInput,
  onSetup,
}: {
  companion: VoiceCompanionProps;
  wakeInput: Parameters<typeof useVoiceWake>[0];
  onSetup: () => void;
}) {
  const wake = useVoiceWake(wakeInput);
  return (
    <Suspense fallback={null}>
      {/* Navigation updates future speech targets without remounting the audio owner. */}
      <Companion {...companion} wakeControls={{ ...wake, onSetup }} />
    </Suspense>
  );
}
