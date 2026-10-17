import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import {
  Check,
  CheckList,
  ChevronRight,
  Clock,
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
import {
  KEYBINDINGS,
  keybindingShortcutLabel,
  loadNotesEnabled,
  subscribeKeybindings,
  subscribeNotesEnabled,
} from "../../settings/model/settings";
import {
  guideActionBlocker,
  loadSeenGuideTopics,
  markGuideTopicSeen,
  runGuideAction,
  type GuideAction,
  type GuideBlocker,
} from "../model/guide";
import { guideTopics } from "../model/guideTopics";
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

function blockerMessage(blocker: GuideBlocker): { text: string; fix: GuideAction; label: string } {
  if (blocker === "notes-disabled")
    return {
      text: t("Notes is turned off."),
      fix: "workspace-settings",
      label: t("Turn on in Settings"),
    };
  return {
    text:
      blocker === "local-project"
        ? t("Open a project folder on this computer first.")
        : t("Open a project first."),
    fix: "open-project",
    label: t("Open a project"),
  };
}

/** Topic-by-topic guide to the workspace. Each topic can reveal its surface. */
export default function GuideHub({
  projectCwd,
  onClose,
  onStartTour,
}: {
  projectCwd: string;
  onClose: () => void;
  onStartTour: () => void;
}) {
  useLocale();
  const [, refreshBindings] = useState(0);
  useEffect(() => subscribeKeybindings(() => refreshBindings((value) => value + 1)), []);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const topics = guideTopics();
  const [activeId, setActiveId] = useState(topics[0].id);
  const [seen, setSeen] = useState(loadSeenGuideTopics);
  const index = Math.max(
    0,
    topics.findIndex((topic) => topic.id === activeId),
  );
  const topic = topics[index];
  const next = topics[index + 1];
  useEffect(() => {
    setSeen(markGuideTopicSeen(topic.id));
  }, [topic.id]);
  const groups: { name: string; items: typeof topics }[] = [];
  for (const item of topics) {
    const group = groups.find((entry) => entry.name === item.group);
    if (group) group.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  const blocker = guideActionBlocker(topic.action.id, { cwd: projectCwd, notesEnabled });
  const fix = blocker ? blockerMessage(blocker) : null;
  const run = (action: GuideAction) => {
    onClose();
    runGuideAction(action);
  };
  const viewed = topics.filter((item) => seen.includes(item.id)).length;

  return (
    <Modal
      title={t("Guide")}
      description={t("{p0} of {p1} topics viewed", { p0: viewed, p1: topics.length })}
      size="lg"
      onClose={onClose}
    >
      <div className="bycoda-arc guide-hub">
        <nav className="guide-hub-nav" aria-label={t("Guide topics")}>
          {groups.map((group) => (
            <div key={group.name} className="guide-hub-group">
              <h3>{group.name}</h3>
              {group.items.map((item) => {
                const Icon = ICONS[item.id];
                return (
                  <Button
                    key={item.id}
                    variant="item"
                    selected={item.id === topic.id}
                    aria-current={item.id === topic.id ? "true" : undefined}
                    startIcon={<Icon size={15} />}
                    onClick={() => setActiveId(item.id)}
                  >
                    <span className="guide-hub-nav-label">{item.title}</span>
                    {seen.includes(item.id) ? (
                      <Check size={13} className="guide-hub-seen" aria-label={t("Viewed")} />
                    ) : null}
                  </Button>
                );
              })}
            </div>
          ))}
        </nav>
        <article key={topic.id} className="guide-hub-content" aria-labelledby="guide-hub-title">
          <h2 id="guide-hub-title">{topic.title}</h2>
          <p className="guide-hub-summary">{topic.summary}</p>
          <div className="guide-hub-actions">
            <Button
              variant="secondary"
              disabled={!!blocker}
              endIcon={<ChevronRight size={14} />}
              onClick={() => run(topic.action.id)}
            >
              {topic.action.label}
            </Button>
            {topic.tour ? (
              <Button startIcon={<Play size={14} />} onClick={onStartTour}>
                {t("Quick tour")}
              </Button>
            ) : null}
          </div>
          {fix ? (
            <p className="guide-hub-blocker" role="status">
              <span>{fix.text}</span>
              <Button variant="link" onClick={() => run(fix.fix)}>
                {fix.label}
              </Button>
            </p>
          ) : null}
          <section className="guide-hub-section">
            <h3>{t("Basics")}</h3>
            <ol className="guide-hub-steps">
              {topic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <details className="guide-hub-advanced">
            <summary>{t("Advanced")}</summary>
            <ul>
              {topic.advanced.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
          {topic.shortcuts.length > 0 ? (
            <section className="guide-hub-section">
              <h3>{t("Shortcuts")}</h3>
              <dl className="guide-hub-shortcuts">
                {topic.shortcuts.map((command) => {
                  const fallback =
                    KEYBINDINGS.find((binding) => binding.command === command)?.keys ?? "";
                  const keys = keybindingShortcutLabel(command, fallback);
                  return (
                    <div key={command}>
                      <dt>{t(command)}</dt>
                      <dd>{keys ? <kbd>{keys}</kbd> : t("Disabled")}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ) : null}
          {next ? (
            <div className="guide-hub-next">
              <Button
                variant="ghost"
                endIcon={<ChevronRight size={14} />}
                onClick={() => setActiveId(next.id)}
              >
                {t("Next: {p0}", { p0: next.title })}
              </Button>
            </div>
          ) : null}
        </article>
      </div>
    </Modal>
  );
}
