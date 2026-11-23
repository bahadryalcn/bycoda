import { lazy, Suspense } from "react";
import { useT } from "../../../../shared/i18n";
import { Heading } from "../../../../shared/ui/Heading";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import type { Session } from "../../../sessions/public/session";
import { voiceLiveResults } from "../../model/voiceLiveWork";
import type { UsageReport } from "../../../usage/public/usageReport";
import type { VoicePresentedResult } from "../../model/voicePresentedResult";
import type { VoiceToolActivityEntry } from "../../model/voiceToolActivity";
import styles from "../VoiceCompanion.module.css";

const VoiceWorkResults = lazy(() =>
  import("./VoiceWorkResults").then((module) => ({ default: module.VoiceWorkResults })),
);
const VoicePresentedAnswer = lazy(() => import("./VoicePresentedAnswer"));
const UsageReportView = lazy(() =>
  import("../../../usage/public/UsageReportView").then((module) => ({
    default: module.UsageReportView,
  })),
);

/** Observed outcomes of the caller-bound active turn. Renders nothing until one exists. */
export function VoiceLiveWorkspace({
  session,
  activities,
  presented,
  usageReport,
}: {
  session?: Pick<Session, "busy" | "blocks">;
  activities: readonly VoiceToolActivityEntry[];
  presented?: VoicePresentedResult;
  /** The report of this turn's `workspace.usage.report`, drawn from its own data. */
  usageReport?: UsageReport;
}) {
  const t = useT();
  const results = voiceLiveResults(session, activities);
  if (!results.length && !presented && !usageReport) return null;
  return (
    <section
      {...surfaceAttributes({ variant: "workspace-panel", frame: "none" }, styles.liveWorkspace)}
      aria-label={t("Live results")}
    >
      <Heading as="h2" size="heading" lines={1}>
        {t("Live results")}
      </Heading>
      <div className="grid min-h-0 min-w-0 flex-1 content-start gap-4 overflow-y-auto">
        <Suspense fallback={null}>
          {usageReport && <UsageReportView report={usageReport} />}
          {presented && <VoicePresentedAnswer result={presented} />}
          {results.length > 0 && <VoiceWorkResults results={results} />}
        </Suspense>
      </div>
    </section>
  );
}
