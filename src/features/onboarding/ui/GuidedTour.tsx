import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ACTIONS, EVENTS, Joyride, STATUS, type EventData, type Step } from "react-joyride";
import { useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Play } from "../../../shared/ui/icons";
import { useOverlay } from "../../../shared/ui/overlay";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";
import { runGuideAction } from "../model/guide";
import type { TourStepDef } from "../model/tourSteps";
import { openUsageGuide } from "../model/usageGuide";
import { findUsageGuideTarget } from "../model/usageGuideTargets";
import {
  COMPACT_TOUR_OPTIONS,
  TOUR_FLOATING,
  compactTourLocale,
  ensureTourTarget,
  useTourArrowKeys,
} from "./tourRunner";
import { UsageGuideTooltip } from "./UsageGuideTooltip";
import "./usageGuide.css";

/** How a guided tour ended; the host decides what to remember. */
export type GuidedTourOutcome =
  | { type: "completed" }
  | { type: "skipped" }
  /** Left with Escape part-way: `stepId` is where to resume. */
  | { type: "paused"; stepId: string }
  /** No step had anything to point at (hidden sidebar, no project, …). */
  | { type: "unavailable" };

/** A real action settles for a moment (a panel opens, a session appears) before the next card. */
const TRY_IT_SETTLE_MS = 350;

/**
 * The compact spotlight tour behind the first-run walkthrough and the "What's new" highlights.
 * It reuses the Guide's Joyride setup and card; the steps are plain data (`TourStepDef`).
 *
 * - Next / Back / Skip, the arrow keys and the close button work; Escape closes and reports the
 *   step so the host can resume there.
 * - Before a card shows, its control is looked up. A hidden one is revealed with the step's
 *   safe action when there is one; otherwise the step is dropped and the progress shrinks
 *   ("3 / 8"), so the tour never stops on a card that points at nothing.
 * - The target is looked up again whenever Joyride re-anchors (resize, scroll, a control that
 *   remounted), so the spotlight follows it without flicker.
 */
export default function GuidedTour({
  steps,
  startStepId,
  projectCwd,
  onStepShown,
  onEnd,
}: {
  steps: readonly TourStepDef[];
  startStepId?: string;
  projectCwd: string;
  /** A card is on screen (the "What's new" tour marks its highlight seen here). */
  onStepShown?: (stepId: string) => void;
  onEnd: (outcome: GuidedTourOutcome) => void;
}) {
  useLocale();
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set());
  const ended = useRef(false);
  const navigation = useRef(0);
  const shown = useRef(false);
  const latest = useRef({ steps, projectCwd, notesEnabled, onStepShown, onEnd, currentId });
  // Handlers and the async walk read the newest props and card without re-subscribing.
  useLayoutEffect(() => {
    latest.current = { steps, projectCwd, notesEnabled, onStepShown, onEnd, currentId };
  });

  const end = (outcome: GuidedTourOutcome) => {
    if (ended.current) return;
    ended.current = true;
    navigation.current++;
    latest.current.onEnd(outcome);
  };

  /** Shows the first available step from `from`, walking in `direction`. */
  const go = async (from: number, direction: 1 | -1, skipped: ReadonlySet<string>) => {
    const token = ++navigation.current;
    const remaining = new Set(skipped);
    const { steps: all, projectCwd: cwd, notesEnabled: notes } = latest.current;
    for (let index = from; index >= 0 && index < all.length; index += direction) {
      const step = all[index];
      if (remaining.has(step.id)) continue;
      const target = await ensureTourTarget(step, { cwd, notesEnabled: notes });
      if (token !== navigation.current || ended.current) return;
      if (target) {
        if (target !== "centered") target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        shown.current = true;
        setDropped(remaining);
        setCurrentId(step.id);
        latest.current.onStepShown?.(step.id);
        return;
      }
      remaining.add(step.id);
    }
    if (token !== navigation.current || ended.current) return;
    setDropped(remaining);
    // Walking back past the first card keeps the current one on screen.
    if (direction > 0) end({ type: shown.current ? "completed" : "unavailable" });
  };

  const indexOfCurrent = () =>
    latest.current.steps.findIndex((step) => step.id === latest.current.currentId);

  useEffect(() => {
    const start = Math.max(
      0,
      steps.findIndex((step) => step.id === startStepId),
    );
    void go(start, 1, new Set());
    return () => {
      navigation.current++;
    };
    // The tour starts once; later changes of `steps` only update the card text.
  }, []);

  const pause = () => {
    const { steps: all, currentId: id } = latest.current;
    end({ type: "paused", stepId: id ?? all[0]?.id ?? "" });
  };
  const overlayRoot = useRef<HTMLElement | null>(document.body);
  useOverlay(overlayRoot, false, pause);

  const next = () => void go(indexOfCurrent() + 1, 1, dropped);
  const previous = () => void go(indexOfCurrent() - 1, -1, dropped);
  useTourArrowKeys(previous, next);

  const tryIt = (step: TourStepDef) => {
    const action = step.tryIt?.action;
    if (!action) return;
    if (action === "usage-guide") {
      end({ type: "completed" });
      openUsageGuide();
      return;
    }
    runGuideAction(action);
    const following = indexOfCurrent() + 1;
    window.setTimeout(() => {
      if (!ended.current) void go(following, 1, dropped);
    }, TRY_IT_SETTLE_MS);
  };

  const visible = steps.filter((step) => !dropped.has(step.id));
  const index = currentId ? visible.findIndex((step) => step.id === currentId) : -1;
  if (index < 0) return <div data-usage-guide-running="true" />;

  const tourSteps: Step[] = visible.map((step) => ({
    id: step.id,
    // A function target is looked up again on every re-anchor, so a remounted control keeps its spotlight.
    target: step.targets.length > 0 ? () => findUsageGuideTarget(step.targets) : document.body,
    placement: step.targets.length > 0 ? "auto" : "center",
    title: step.title,
    data: { compact: true },
    content: (
      <div className="usage-guide-content" data-usage-guide-tooltip>
        <p id="usage-guide-description" className="usage-guide-description">
          {step.body}
        </p>
        {step.tryIt ? (
          <Button
            className="usage-guide-tryit"
            variant="secondary"
            size="sm"
            startIcon={<Play size={13} aria-hidden="true" />}
            onClick={() => tryIt(step)}
          >
            {step.tryIt.label}
          </Button>
        ) : null}
      </div>
    ),
  }));

  const onEvent = (event: EventData) => {
    if (event.type === EVENTS.TARGET_NOT_FOUND) {
      // The control disappeared under the card: look again, and move on when it stays gone.
      void go(indexOfCurrent(), 1, dropped);
    } else if (event.status === STATUS.SKIPPED || event.action === ACTIONS.CLOSE) {
      end({ type: "skipped" });
    } else if (event.type === EVENTS.STEP_AFTER) {
      if (event.action === ACTIONS.PREV) previous();
      else next();
    } else if (event.status === STATUS.FINISHED) {
      end({ type: "completed" });
    }
  };

  return (
    <div data-usage-guide-running="true">
      <Joyride
        run
        continuous
        stepIndex={index}
        steps={tourSteps}
        onEvent={onEvent}
        tooltipComponent={UsageGuideTooltip}
        floatingOptions={TOUR_FLOATING}
        options={COMPACT_TOUR_OPTIONS}
        styles={{ spotlight: { strokeWidth: 2 } }}
        locale={compactTourLocale()}
      />
    </div>
  );
}
