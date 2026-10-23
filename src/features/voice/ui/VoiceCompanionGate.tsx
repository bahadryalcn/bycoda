import { lazy, Suspense } from "react";
import { useVoiceSettings, voiceRuntimeSettings } from "../model/voiceSettings";
import type { VoiceCompanionProps } from "./VoiceCompanion";

const Companion = lazy(() =>
  import("./VoiceCompanion").then((module) => ({ default: module.VoiceCompanion })),
);

/** Opt-in, per device. Unmounting releases voice while coding turns continue. */
export function VoiceCompanionGate(props: VoiceCompanionProps) {
  const settings = useVoiceSettings();
  return settings.enabled ? (
    <Suspense fallback={null}>
      <Companion key={JSON.stringify(voiceRuntimeSettings(settings))} {...props} />
    </Suspense>
  ) : null;
}
