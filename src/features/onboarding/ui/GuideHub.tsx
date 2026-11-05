import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Tooltip } from "../../../shared/ui/Tooltip";
import {
  ArrowLeft,
  Check,
  CheckList,
  ChevronRight,
  Clock,
  Eye,
  FolderOpen,
  FolderTree,
  GitBranch,
  Globe,
  Inbox,
  MessageSquare,
  Play,
  Settings,
  Share,
  StickyNote,
  Terminal,
  type IconComponent,
} from "../../../shared/ui/icons";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";
import { getGuideActivitySnapshot, subscribeGuideActivity } from "../model/guideActivity";
import { getTourSnapshot, startTour, subscribeTour } from "../model/tourState";
import { usePendingHighlights } from "../model/useFeatureHighlights";
import {
  guideSignals,
  loadDoneGuideSteps,
  loadSeenGuideTopics,
  markGuideTopicSeen,
  runGuideAction,
  setGuideStepDone,
  type GuideAction,
  type GuideSignal,
} from "../model/guide";
import {
  gettingStartedSteps,
  guideBlockerHelp,
  guideTopics,
  type GuideStep,
  type GuideTopic,
} from "../model/guideTopics";
import { GuideShortcuts } from "./GuideShortcuts";
import "./guideHub.css";

const ICONS: Record<string, IconComponent> = {
  projects: FolderOpen,
  chat: MessageSquare,
  changes: GitBranch,
  files: FolderTree,
  terminal: Terminal,
  tasks: CheckList,
  automations: Clock,
  notes: StickyNote,
  inbox: Inbox,
  social: Share,
  machines: Globe,
  settings: Settings,
};

/** A step is finished when the app already shows it or the user did/ticked it. */
function isStepDone(step: GuideStep, done: readonly string[], signals: ReadonlySet<GuideSignal>) {
  return done.includes(step.id) || (!!step.done && signals.has(step.done));
}

/** Topic-by-topic guide to the workspace. Each step can be shown in the app. */
export default function GuideHub({
  projectCwd,
  initialTopic,
  onClose,
  onStartTour,
  onShowStep,
}: {
  projectCwd: string;
  /** Topic to open on; used when returning from a "Show me" spotlight. */
  initialTopic?: string;
  onClose: () => void;
  onStartTour: (topicId: string) => void;
  /** Collapses the guide and spotlights the step's control; the host then comes back here. */
  onShowStep?: (topicId: string, stepId: string) => void;
}) {
  useLocale();
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  // Re-read the signals when the app records that a terminal or a diff was opened.
  useSyncExternalStore(subscribeGuideActivity, getGuideActivitySnapshot, () => "");
  // The tour entries: "Resume" while a tour was left part-way, and "What's new" after an update.
  const tourState = useSyncExternalStore(subscribeTour, getTourSnapshot, () => "");
  const hasNews = usePendingHighlights().length > 0;
  const topics = guideTopics();
  const [activeId, setActiveId] = useState(
    topics.some((entry) => entry.id === initialTopic) ? (initialTopic as string) : topics[0].id,
  );
  const [seen, setSeen] = useState(loadSeenGuideTopics);
  const [doneSteps, setDoneSteps] = useState(loadDoneGuideSteps);
  const index = Math.max(
    0,
    topics.findIndex((topic) => topic.id === activeId),
  );
  const topic = topics[index];
  const previous = topics[index - 1];
  const next = topics[index + 1];
  useEffect(() => {
    setSeen(markGuideTopicSeen(topic.id));
  }, [topic.id]);
  const signals = guideSignals(projectCwd);
  const stepDone = (step: GuideStep) => isStepDone(step, doneSteps, signals);
  const groups: { name: string; items: GuideTopic[] }[] = [];
  for (const item of topics) {
    const group = groups.find((entry) => entry.name === item.group);
    if (group) group.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  const context = { cwd: projectCwd, notesEnabled };
  const blocker = guideBlockerHelp(topic.action.id, context);
  const run = (action: GuideAction) => {
    onClose();
    runGuideAction(action);
  };
  const tryIt = () => {
    // Opening a folder is detected from the project list, not recorded here.
    if (topic.action.id !== "open-project") setDoneSteps(setGuideStepDone(topic.action.step, true));
    run(topic.action.id);
  };
  const allSteps = topics.flatMap((item) => item.steps);
  const finished = allSteps.filter(stepDone).length;
  const topicFinished = topic.steps.filter(stepDone).length;
  const firstSteps = gettingStartedSteps().map((item) => ({
    ...item,
    done: allSteps.some((step) => step.id === item.stepId && stepDone(step)),
  }));
  const upNext = firstSteps.find((item) => !item.done);

  return (
    <Modal
      title={t("Guide")}
      description={t("{p0} of {p1} steps done", { p0: finished, p1: allSteps.length })}
      size="lg"
      onClose={onClose}
    >
      <div className="bycoda-arc guide-hub">
        <div className="guide-hub-start" role="group" aria-label={t("First steps")}>
          <span className="guide-hub-start-title">{t("First steps")}</span>
          <ol className="guide-hub-start-list">
            {firstSteps.map((item) => (
              <li key={item.stepId}>
                <Button
                  variant="ghost"
                  size="sm"
                  selected={item === upNext}
                  aria-current={item === upNext ? "step" : undefined}
                  startIcon={
                    item.done ? (
                      <Check className="icon-sm" aria-hidden="true" />
                    ) : (
                      <span className="guide-hub-ring" aria-hidden="true" />
                    )
                  }
                  onClick={() => setActiveId(item.topicId)}
                >
                  {item.label}
                </Button>
              </li>
            ))}
          </ol>
          <span className="guide-hub-start-next" role="status">
            {upNext ? t("Up next: {p0}", { p0: upNext.label }) : t("All set")}
          </span>
          <div className="guide-hub-start-tour">
            {hasNews ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClose();
                  startTour("whats-new");
                }}
              >
                {t("What's new")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              startIcon={<Play className="icon-sm" aria-hidden="true" />}
              onClick={() => {
                onClose();
                startTour("first-run");
              }}
            >
              {tourState.startsWith("paused:") ? t("Resume tour") : t("Take the tour")}
            </Button>
          </div>
        </div>
        <nav className="guide-hub-nav" aria-label={t("Guide topics")}>
          {groups.map((group) => (
            <div key={group.name} className="guide-hub-group">
              <h3>{group.name}</h3>
              {group.items.map((item) => {
                const Icon = ICONS[item.id];
                const complete = item.steps.every(stepDone);
                return (
                  <Button
                    key={item.id}
                    variant="item"
                    selected={item.id === topic.id}
                    aria-current={item.id === topic.id ? "true" : undefined}
                    startIcon={<Icon className="icon-md" />}
                    onClick={() => setActiveId(item.id)}
                  >
                    <span className="guide-hub-nav-label">{item.title}</span>
                    {complete ? (
                      <Check className="icon-sm guide-hub-complete" aria-label={t("Done")} />
                    ) : seen.includes(item.id) ? (
                      <Check className="icon-sm guide-hub-seen" aria-label={t("Viewed")} />
                    ) : null}
                  </Button>
                );
              })}
            </div>
          ))}
        </nav>
        <article key={topic.id} className="guide-hub-content" aria-labelledby="guide-hub-title">
          <header className="guide-hub-heading">
            <h2 id="guide-hub-title">{topic.title}</h2>
            <span className="guide-hub-count">
              {t("{p0} of {p1} done", { p0: topicFinished, p1: topic.steps.length })}
            </span>
          </header>
          <p className="guide-hub-summary">{topic.summary}</p>
          <div className="guide-hub-actions">
            <Button
              variant="primary"
              disabled={!!blocker}
              endIcon={<ChevronRight className="icon-sm" />}
              onClick={tryIt}
            >
              {topic.action.label}
            </Button>
            {topic.tour ? (
              <Button
                variant="secondary"
                startIcon={<Play className="icon-sm" />}
                onClick={() => onStartTour(topic.id)}
              >
                {t("Quick tour")}
              </Button>
            ) : null}
          </div>
          {blocker ? (
            <p className="guide-hub-blocker" role="status">
              <span>{blocker.reason}</span>
              <Button variant="link" onClick={() => run(blocker.action)}>
                {blocker.label}
              </Button>
            </p>
          ) : null}
          <section className="guide-hub-section">
            <h3>{t("Steps")}</h3>
            <ol className="guide-hub-steps">
              {topic.steps.map((step, position) => {
                const done = stepDone(step);
                const automatic = !!step.done && signals.has(step.done);
                return (
                  <li key={step.id} data-done={done ? "true" : undefined}>
                    {/* aria-disabled (not disabled) keeps the pointer and focus events the tooltip needs. */}
                    <Tooltip label={automatic ? t("Done") : undefined}>
                      <button
                        type="button"
                        className="guide-hub-step-mark"
                        aria-pressed={done}
                        aria-label={done ? t("Mark as not done") : t("Mark as done")}
                        aria-disabled={automatic || undefined}
                        onClick={() => {
                          if (!automatic) setDoneSteps(setGuideStepDone(step.id, !done));
                        }}
                      >
                        {done ? <Check className="icon-xs" aria-hidden="true" /> : position + 1}
                      </button>
                    </Tooltip>
                    <div className="guide-hub-step-body">
                      <span className="guide-hub-step-title">{step.title}</span>
                      <span id={`guide-step-${step.id}`} className="guide-hub-step-text">
                        {step.text}
                      </span>
                    </div>
                    {step.show && onShowStep ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        startIcon={<Eye className="icon-sm" aria-hidden="true" />}
                        aria-describedby={`guide-step-${step.id}`}
                        onClick={() => onShowStep(topic.id, step.id)}
                      >
                        {t("Show me")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
          {topic.tips.length > 0 ? (
            <details className="guide-hub-tips">
              <summary>
                <ChevronRight className="icon-sm" aria-hidden="true" />
                {t("Tips")}
              </summary>
              <ul>
                {topic.tips.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {topic.shortcuts.length > 0 ? (
            <section className="guide-hub-section">
              <h3>{t("Shortcuts")}</h3>
              <GuideShortcuts items={topic.shortcuts} className="guide-hub-shortcuts" />
            </section>
          ) : null}
          <nav className="guide-hub-pager" aria-label={t("Guide pages")}>
            {previous ? (
              <Button
                variant="ghost"
                startIcon={<ArrowLeft className="icon-sm" />}
                onClick={() => setActiveId(previous.id)}
              >
                {t("Previous: {p0}", { p0: previous.title })}
              </Button>
            ) : (
              <span />
            )}
            {next ? (
              <Button
                variant="ghost"
                endIcon={<ChevronRight className="icon-sm" />}
                onClick={() => setActiveId(next.id)}
              >
                {t("Next: {p0}", { p0: next.title })}
              </Button>
            ) : null}
          </nav>
        </article>
      </div>
    </Modal>
  );
}
