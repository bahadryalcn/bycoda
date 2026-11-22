import { lazy, Suspense } from "react";
import { useT } from "../../../../shared/i18n";
import { Heading } from "../../../../shared/ui/Heading";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import type { Session } from "../../../sessions/public/session";
import { voiceLiveResults } from "../../model/voiceLiveWork";
import type { VoiceToolActivityEntry } from "../../model/voiceToolActivity";
import styles from "../VoiceCompanion.module.css";

const VoiceWorkResults = lazy(() =>
  import("./VoiceWorkResults").then((module) => ({ default: module.VoiceWorkResults })),
);

/** Observed outcomes of the caller-bound active turn. Renders nothing until one exists. */
export function VoiceLiveWorkspace({
  session,
  activities,
}: {
  session?: Pick<Session, "busy" | "blocks">;
  activities: readonly VoiceToolActivityEntry[];
}) {
  const t = useT();
  const results = voiceLiveResults(session, activities);
  if (!results.length) return null;
  return (
    <section
      {...surfaceAttributes({ variant: "workspace-panel", frame: "none" }, styles.liveWorkspace)}
      aria-label={t("Results")}
    >
      <Heading as="h2" size="heading" lines={1}>
        {t("Results")}
      </Heading>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <Suspense fallback={null}>
          <VoiceWorkResults results={results} />
        </Suspense>
      </div>
    </section>
  );
}
