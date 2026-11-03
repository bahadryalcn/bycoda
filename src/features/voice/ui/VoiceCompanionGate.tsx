import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Mic } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { assistantRequest, useAssistantSnapshot } from "../../assistant/model/assistantClient";
import { migrateVoiceOwnerMemory } from "../model/voiceHostMemory";
import { AssistantSetup } from "../../assistant/ui/AssistantSetup";
import { useVoiceSettings } from "../model/voiceSettings";
import type { VoiceCompanionProps } from "./VoiceCompanion";

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
        <Button
          iconOnly
          label={t(error ? "Retry" : "Set up voice")}
          tooltip={error || t("Set up voice")}
          loading={loading}
          onClick={() => (snapshot ? setSetup(true) : void refresh())}
        >
          <Mic className="icon-lg" />
        </Button>
        {setup && snapshot ? <AssistantSetup voice onClose={() => setSetup(false)} /> : null}
      </>
    );
  return settings.enabled ? (
    <Suspense fallback={null}>
      {/* The companion ends its own connection when the conversation or voice
          changes, so the panel stays open for choices made inside it. */}
      <Companion {...props} />
    </Suspense>
  ) : null;
}
