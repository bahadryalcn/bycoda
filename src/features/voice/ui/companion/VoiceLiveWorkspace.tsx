import { lazy, Suspense, useState } from "react";
import { Button } from "../../../../shared/ui/Button";
import { Maximize2, Minimize2 } from "../../../../shared/ui/icons";
import { useT } from "../../../../shared/i18n";
import { Heading } from "../../../../shared/ui/Heading";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import type { Session } from "../../../sessions/public/session";
import { voiceLiveResults } from "../../model/voiceLiveWork";
import type { UsageReport } from "../../../usage/public/usageReport";
import type { VoicePresentedActionResponse } from "../../model/voicePresentedActions";
import type {
  VoicePresentedActionButton,
  VoicePresentedResult,
} from "../../model/voicePresentedResult";
import type { VoiceToolActivityEntry } from "../../model/voiceToolActivity";
import styles from "../VoiceCompanion.module.css";

const VoiceWorkResults = lazy(() =>
  import("./VoiceWorkResults").then((module) => ({ default: module.VoiceWorkResults })),
);
const LazyPresentedAnswer = lazy(() => import("./VoicePresentedAnswer"));
/** Set once the renderer has loaded, so a presentation can paint in the commit that requests it. */
const loadedAnswer: { view?: typeof import("./VoicePresentedAnswer").default } = {};
export async function preloadPresentedAnswer() {
  loadedAnswer.view ??= (await import("./VoicePresentedAnswer")).default;
}
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
  presentedVersion = 0,
  onPresentedAction,
  usageReport,
}: {
  session?: Pick<Session, "busy" | "blocks">;
  activities: readonly VoiceToolActivityEntry[];
  presented?: VoicePresentedResult;
  /** Which presentation `presented` is; a button press names it so a replaced view cannot act. */
  presentedVersion?: number;
  onPresentedAction?: (
    version: number,
    button: VoicePresentedActionButton,
  ) => Promise<VoicePresentedActionResponse | void>;
  /** The report of this turn's `workspace.usage.report`, drawn from its own data. */
  usageReport?: UsageReport;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const results = voiceLiveResults(session, activities);
  const VoicePresentedAnswer = loadedAnswer.view ?? LazyPresentedAnswer;
  if (!results.length && !presented && !usageReport) return null;
  return (
    <section
      {...surfaceAttributes({ variant: "workspace-panel", frame: "none" }, styles.liveWorkspace)}
      aria-label={t("Live results")}
      data-expanded={expanded || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <Heading as="h2" size="heading" lines={1}>
          {t("Live results")}
        </Heading>
        <Button
          iconOnly
          variant="ghost"
          label={t(expanded ? "Restore panel layout" : "Maximize panel")}
          pressed={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={styles.resultsSizeToggle}
        >
          {expanded ? <Minimize2 className="icon-sm" /> : <Maximize2 className="icon-sm" />}
        </Button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto">
        <Suspense fallback={null}>
          {usageReport && <UsageReportView report={usageReport} />}
          {presented && (
            <VoicePresentedAnswer
              result={presented}
              version={presentedVersion}
              observed={results}
              onAction={(button) =>
                onPresentedAction
                  ? onPresentedAction(presentedVersion, button)
                  : Promise.reject(new Error("This view cannot run actions."))
              }
            />
          )}
          {results.length > 0 && <VoiceWorkResults results={results} />}
        </Suspense>
      </div>
    </section>
  );
}
