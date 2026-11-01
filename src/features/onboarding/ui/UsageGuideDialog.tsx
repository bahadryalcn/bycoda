import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ACTIONS, EVENTS, Joyride, STATUS, type EventData, type Step } from "react-joyride";
import { t, useLocale } from "../../../shared/i18n";
import { useOverlay } from "../../../shared/ui/overlay";
import { Button } from "../../../shared/ui/Button";
import { MessageSquare, Check } from "../../../shared/ui/icons";
import { UsageGuideTooltip } from "./UsageGuideTooltip";
import { GuideShortcuts } from "./GuideShortcuts";
import { findUsageGuideTarget } from "../model/usageGuideTargets";
import { TOUR_FLOATING, TOUR_OPTIONS, tourLocale, useTourArrowKeys } from "./tourRunner";
import { runGuideAction, setGuideStepDone, type GuideAction } from "../model/guide";
import { guideMissingHelp, guideTopics } from "../model/guideTopics";
import { tourPlan } from "../model/guideTours";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";
import "./usageGuide.css";

/** Fixes that open a dialog or window of their own; the tour steps aside for them. */
const LEAVES_TOUR: ReadonlySet<GuideAction> = new Set([
  "open-project",
  "command-palette",
  "workspace-settings",
  "connections",
  "keybindings",
]);

export type UsageGuideCloseReason = "action";

/**
 * Spotlight tour. With `stepId` it shows that one step only ("Show me" in the guide),
 * otherwise the topic's quick tour (chat by default). Next/Back/Skip, the arrow keys and
 * Escape all work; a missing control is explained and can be opened from the step.
 */
export default function UsageGuideDialog({
  onClose,
  tourId = "chat",
  stepId,
  projectCwd = "~",
}: {
  onClose: (reason?: UsageGuideCloseReason) => void;
  tourId?: string;
  stepId?: string;
  projectCwd?: string;
}) {
  useLocale();
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const closed = useRef(false);
  const plan = tourPlan(tourId, stepId) ?? tourPlan("chat");
  const steps = plan?.steps ?? [];
  const close = useCallback(
    (reason?: UsageGuideCloseReason) => {
      if (closed.current) return;
      closed.current = true;
      onClose(reason);
    },
    [onClose],
  );
  /** Completing a tour (or spotlight) ticks off what it covered. */
  const finish = () => {
    if (plan && !closed.current) {
      const topic = guideTopics().find((entry) => entry.id === plan.topicId);
      if (stepId) {
        if (findUsageGuideTarget(steps[0]?.targets ?? [])) setGuideStepDone(stepId, true);
      } else {
        for (const entry of topic?.steps ?? []) setGuideStepDone(entry.id, true);
      }
    }
    close();
  };
  const overlayRoot = useRef<HTMLElement | null>(document.body);
  useOverlay(overlayRoot, false, () => close());
  const last = steps.length - 1;
  useTourArrowKeys(
    () => setStep(Math.max(0, step - 1)),
    () => {
      if (step >= last) finish();
      else setStep(step + 1);
    },
  );
  // Workspace controls can mount in the same commit as the guide. Resolve the
  // first spotlight only after those DOM nodes exist, before the browser paints.
  useLayoutEffect(() => setReady(true), []);
  if (!ready) return <div data-usage-guide-running="true" />;
  const tourSteps: Step[] = steps.map((current) => {
    const target = findUsageGuideTarget(current.targets);
    const help =
      !target && current.need
        ? guideMissingHelp(current.need, { cwd: projectCwd, notesEnabled })
        : null;
    return {
      target: target ?? document.body,
      placement: target ? "auto" : "center",
      title: current.title,
      // A new attempt number makes the targets resolve again after a fix or a recheck.
      data: { attempt: recheck },
      content: (
        <section
          className="usage-guide-content"
          data-usage-guide-tooltip
          aria-label={t("Usage guide")}
        >
          <p id="usage-guide-description" className="usage-guide-description">
            {current.description}
          </p>
          {help ? (
            <div className="usage-guide-missing" role="status">
              <p>{help.reason}</p>
              <div className="usage-guide-missing-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (LEAVES_TOUR.has(help.action)) {
                      close("action");
                      runGuideAction(help.action);
                      return;
                    }
                    runGuideAction(help.action);
                    window.setTimeout(() => setRecheck((value) => value + 1), 400);
                  }}
                >
                  {help.label}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRecheck((value) => value + 1)}>
                  {t("Check again")}
                </Button>
              </div>
            </div>
          ) : null}
          {current.example ? (
            <blockquote className="usage-guide-example">
              <MessageSquare className="icon-md" aria-hidden="true" />
              <p>{current.example}</p>
            </blockquote>
          ) : null}
          {current.tips.length > 0 ? (
            <ul className="usage-guide-tips">
              {current.tips.map((tip) => (
                <li key={tip}>
                  <Check className="icon-md" aria-hidden="true" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {current.shortcuts.length > 0 ? (
            <div className="usage-guide-shortcut-section">
              <h3>{t("Shortcuts")}</h3>
              <GuideShortcuts items={current.shortcuts} className="usage-guide-shortcuts" />
            </div>
          ) : null}
        </section>
      ),
    };
  });
  const onEvent = (event: EventData) => {
    if (event.status === STATUS.FINISHED) {
      finish();
    } else if (event.status === STATUS.SKIPPED || event.action === ACTIONS.CLOSE) {
      close();
    } else if (event.type === EVENTS.TARGET_NOT_FOUND) {
      // Re-resolve a disappearing live control using the safe composer/body fallback.
      setRecheck((value) => value + 1);
    } else if (event.type === EVENTS.STEP_AFTER) {
      // Controlled tours must end explicitly rather than pinning the index to
      // the last step, which leaves Joyride's backdrop mounted after Done.
      if (event.index === last && event.action === ACTIONS.NEXT) {
        finish();
        return;
      }
      setStep(Math.max(0, Math.min(last, event.index + (event.action === ACTIONS.PREV ? -1 : 1))));
    }
  };

  return (
    <div data-usage-guide-running="true">
      <Joyride
        run
        continuous
        stepIndex={step}
        steps={tourSteps}
        onEvent={onEvent}
        tooltipComponent={UsageGuideTooltip}
        floatingOptions={TOUR_FLOATING}
        options={TOUR_OPTIONS}
        locale={tourLocale()}
      />
    </div>
  );
}
