import { lazy, Suspense } from "react";
import { useVoiceSettings } from "../model/voiceSettings";
import type { VoiceCompanionProps } from "./VoiceCompanion";

const Companion = lazy(() =>
  import("./VoiceCompanion").then((module) => ({ default: module.VoiceCompanion })),
);

/** Opt-in, per device. Unmounting releases voice while coding turns continue. */
export function VoiceCompanionGate(props: VoiceCompanionProps) {
  const settings = useVoiceSettings();
  return settings.enabled ? (
    <Suspense fallback={null}>
      {/* The companion ends its own connection when the conversation or voice
          changes, so the panel stays open for choices made inside it. */}
      <Companion {...props} />
    </Suspense>
  ) : null;
}
