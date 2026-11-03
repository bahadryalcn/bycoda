import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Mic } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { assistantRequest, useAssistantSnapshot } from "../../assistant/model/assistantClient";
import { migrateVoiceOwnerMemory } from "../model/voiceHostMemory";
import { AssistantSetup } from "../../assistant/ui/AssistantSetup";
import { useVoiceSettings } from "../model/voiceSettings";
import type { VoiceCompanionProps } from "./VoiceCompanion";
import styles from "./VoiceCompanion.module.css";

const Companion = lazy(() =>
  import("./VoiceCompanion").then((module) => ({ default: module.VoiceCompanion })),
);

/** Opt-in, per device. Unmounting releases voice while coding turns continue. */
export function VoiceCompanionGate(props: VoiceCompanionProps) {
  const settings = useVoiceSettings();
  const { snapshot, error, loading, refresh } = useAssistantSnapshot();
  const [setup, setSetup] = useState(false);
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
        <div className={styles.launcher}>
          <Button
            iconOnly
            label={t(error ? "Retry" : "Set up voice")}
            tooltip={error || t("Set up voice")}
            loading={loading}
            onClick={() => (snapshot ? setSetup(true) : void refresh())}
          >
            <Mic size={18} />
          </Button>
        </div>
        {setup && snapshot ? <AssistantSetup voice onClose={() => setSetup(false)} /> : null}
      </>
    );
  return settings.enabled ? (
    <Suspense fallback={null}>
      {/* Navigation updates future speech targets without remounting the audio owner. */}
      <Companion {...props} />
    </Suspense>
  ) : null;
}
