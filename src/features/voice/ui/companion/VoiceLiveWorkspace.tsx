import { lazy, Suspense, useState, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { pathKey } from "../../../../shared/lib/paths";
import { Button } from "../../../../shared/ui/Button";
import { CopyButton } from "../../../../shared/ui/CopyButton";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { Heading } from "../../../../shared/ui/Heading";
import {
  AudioLines,
  ChevronDown,
  ExternalLink,
  ListEnd,
  SquareKanban,
  Terminal,
} from "../../../../shared/ui/icons";
import { ListRow } from "../../../../shared/ui/ListRow";
import { OutputBlock } from "../../../../shared/ui/OutputBlock";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { Select } from "../../../../shared/ui/Select";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { Tab, TabList, TabPanel, Tabs } from "../../../../shared/ui/Tabs";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { currentExecutionTools, inspectCommand } from "../../../sessions/public/commandInspection";
import type { Session } from "../../../sessions/public/session";
import type { VoiceToolActivityEntry } from "../../model/voiceToolActivity";
import type { VoiceWorkspaceTool } from "../../model/voiceLiveWork";
import { voiceWorkspaceJobStatus, type VoiceWorkspaceJob } from "../../model/voiceWorkspaceJobs";
import type { VoiceWorkspaceTrackedWork } from "../../model/voiceWorkspaceTrackedWork";
import { voiceActionLabel } from "../VoiceToolActivityPanel";
import styles from "../VoiceCompanion.module.css";
import type { VoiceWorkFilter } from "./VoiceWorkSummary";
import { VoiceWorkComparison } from "./VoiceWorkComparison";
import { VoiceWorkDraft } from "./VoiceWorkDraft";

const VoiceWorkSummary = lazy(() =>
  import("./VoiceWorkSummary").then((module) => ({ default: module.VoiceWorkSummary })),
);
const VoiceWorkResults = lazy(() =>
  import("./VoiceWorkResults").then((module) => ({ default: module.VoiceWorkResults })),
);
const toolTabs = {
  changes: "Changes",
  browser: "Browser",
  devices: "Devices",
  logs: "Logs",
} as const;
type WorkPanel = "activity" | "results" | "compare" | "draft" | VoiceWorkspaceTool;

const commandStatus = {
  running: ["Working", "accent"],
  done: ["Completed", "success"],
  failed: ["Failed", "danger"],
  stopped: ["Cancelled", "muted"],
  interrupted: ["Unknown", "warning"],
} as const;
const activityStatus = {
  running: ["running", "Working"],
  "waiting-owner": ["running", "Waiting for approval"],
  returned: ["done", "Done"],
  uncertain: ["interrupted", "Unknown"],
  failed: ["failed", "Failed"],
} as const;
const emptyOutput = {
  running: "Running. No output has been reported yet; new output appears here.",
  done: "Finished. The command reported no output.",
  stopped: "Stopped before it reported any output.",
  interrupted: "Interrupted before it reported any output. Its final state was not reported.",
  failed: "Failed without reporting output.",
} as const;
const viewLabels: Readonly<Record<string, string>> = {
  conversation: "Conversation",
  servers: "Servers",
  notes: "Notes",
  inbox: "Inbox",
  automations: "Automations",
  tasks: "Tasks",
  social: "Social media",
  search: "Search",
  settings: "Settings",
  files: "Files",
  terminal: "Terminal",
};
const trackedWorkLabels = { task: "Task", goal: "Goal", crew: "Crew" } as const;

function workSource(item: ReturnType<typeof workItems>[number]) {
  return item.kind === "tracked"
    ? trackedWorkLabels[item.work.kind]
    : { command: "Command", job: "Job", voice: "Voice" }[item.kind];
}

function workItems(
  session: Session | undefined,
  activities: readonly VoiceToolActivityEntry[],
  jobs: readonly VoiceWorkspaceJob[],
  trackedWork: readonly VoiceWorkspaceTrackedWork[],
) {
  const execution = session ? currentExecutionTools(session.blocks) : undefined;
  const turn = execution?.turnId
    ? session?.blocks.find((block) => block.id === execution.turnId)
    : undefined;
  return [
    ...(execution?.tools ?? []).reverse().map((block) => {
      const inspection = inspectCommand(block, session?.busy === true);
      return {
        id: `command:${block.id}`,
        title: inspection.command.text,
        status: inspection.lifecycle,
        label: commandStatus[inspection.lifecycle][0],
        kind: "command" as const,
        at:
          block.agentRun?.endedAt ??
          block.agentRun?.startedAt ??
          block.startedAt ??
          turn?.startedAt ??
          0,
        inspection,
      };
    }),
    ...activities
      .slice()
      .reverse()
      .map((entry) => ({
        id: `voice:${entry.id}`,
        title: voiceActionLabel(entry.name),
        status: activityStatus[entry.state][0],
        label: activityStatus[entry.state][1],
        kind: "voice" as const,
        at: performance.timeOrigin + entry.startedAt,
        entry,
      })),
    ...jobs.map((job) => ({
      id: `job:${job.environmentId}:${job.id}`,
      title: job.title,
      status: voiceWorkspaceJobStatus[job.status].filter,
      label: voiceWorkspaceJobStatus[job.status].label,
      kind: "job" as const,
      at: job.updatedAt,
      job,
    })),
    ...trackedWork.map((work) => ({
      id: `${work.kind}:${work.environmentId}:${work.id}`,
      title: work.title,
      status: work.lifecycle,
      label: work.label,
      kind: "tracked" as const,
      at: work.updatedAt ?? 0,
      work,
    })),
  ].sort((left, right) => (right.at || 0) - (left.at || 0));
}

export function VoiceLiveWorkspace({
  session,
  activities,
  onOpenSession,
  views,
  onOpenView,
  onStopWaiting,
  jobs,
  trackedWork = [],
  onOpenTrackedWork,
  renderTool,
  draft,
  onDraftChange,
}: {
  session?: Session;
  activities: readonly VoiceToolActivityEntry[];
  onOpenSession?: () => void;
  views?: readonly string[];
  onOpenView?: (view: string) => void;
  onStopWaiting: (id: string) => void;
  jobs: readonly VoiceWorkspaceJob[];
  trackedWork?: readonly VoiceWorkspaceTrackedWork[];
  onOpenTrackedWork?: (work: VoiceWorkspaceTrackedWork) => void;
  renderTool?: (panel: VoiceWorkspaceTool, session: Session) => ReactNode;
  draft?: string;
  onDraftChange: (draft: string) => void;
}) {
  const [panel, setPanel] = useState<WorkPanel>("activity");
  const [visitedResults, setVisitedResults] = useState(false);
  const [filter, setFilter] = useState<VoiceWorkFilter>("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const items = workItems(session, activities, jobs, trackedWork);
  const sources = [...new Set(items.map(workSource))];
  const normalizedSource = sources.find((value) => value === source) ?? "all";
  const sourceItems =
    normalizedSource === "all"
      ? items
      : items.filter((item) => workSource(item) === normalizedSource);
  const counts = {
    all: sourceItems.length,
    running: 0,
    done: 0,
    failed: 0,
    stopped: 0,
    interrupted: 0,
  };
  for (const item of sourceItems) counts[item.status]++;
  const term = query.trim().toLocaleLowerCase();
  const shown = sourceItems.filter(
    (item) =>
      (filter === "all" || item.status === filter) &&
      (!term || item.title.toLocaleLowerCase().includes(term)),
  );
  const selected = shown.find((item) => item.id === selectedId) ?? shown[0];
  const commandResults = items.filter((item) => item.kind === "command");
  const project = session && pathKey(session.cwd);
  const workEnvironments = [
    ...new Set([...jobs, ...trackedWork].map((work) => work.environmentId)),
  ];
  const modelLayout =
    session &&
    project &&
    workEnvironments.length <= 1 &&
    activities.every((activity) => pathKey(activity.projectPath) === project) &&
    jobs.every((job) => job.projectNames.length === 1 && job.sessionIds.includes(session.id)) &&
    trackedWork.every((work) => pathKey(work.projectPath) === project)
      ? {
          projectPath: session.cwd,
          scopeId: JSON.stringify([project, session.id]),
          expectedEnvironmentId: workEnvironments[0],
        }
      : undefined;
  const activePanel =
    panel === "results" ||
    (panel === "compare" && commandResults.length > 1) ||
    (panel === "draft" && draft !== undefined) ||
    (panel in toolTabs && session && renderTool)
      ? panel
      : "activity";
  return (
    <section
      {...surfaceAttributes({ variant: "workspace-panel", frame: "none" }, styles.liveWorkspace)}
      aria-label={t("Activity")}
    >
      <header className={styles.liveWorkHeader}>
        <Heading as="h2" size="heading" lines={2}>
          {session?.title || t("Activity")}
        </Heading>
        <div className={styles.liveWorkActions}>
          {onOpenSession && session && (
            <Button variant="ghost" iconOnly label={t("Open conversation")} onClick={onOpenSession}>
              <ExternalLink className="icon-sm" />
            </Button>
          )}
          {views?.length && onOpenView ? (
            <>
              <Button
                aria-haspopup="menu"
                expanded={Boolean(menu)}
                endIcon={<ChevronDown className="icon-sm" />}
                onClick={(event) => setMenu(event.currentTarget)}
              >
                {t("Workspace")}
              </Button>
              {menu && (
                <DropdownMenu
                  anchor={menu}
                  label={t("Workspace")}
                  items={views.map((view) => ({
                    kind: "item",
                    id: view,
                    label: viewLabels[view] ? t(viewLabels[view]) : view,
                  }))}
                  onClose={() => setMenu(null)}
                  onPick={onOpenView}
                />
              )}
            </>
          ) : null}
        </div>
      </header>
      <Tabs
        value={activePanel}
        onValueChange={(value) => {
          if (value === "results") setVisitedResults(true);
          setPanel(value);
        }}
        panels="shared"
        activation="manual"
      >
        <TabList label={t("Workspace")}>
          <Tab value="activity">{t("Activity")}</Tab>
          <Tab value="results">{t("Results")}</Tab>
          {commandResults.length > 1 && <Tab value="compare">{t("Compare")}</Tab>}
          {draft !== undefined && <Tab value="draft">{t("Draft")}</Tab>}
          {session &&
            renderTool &&
            (Object.keys(toolTabs) as VoiceWorkspaceTool[]).map((tool) => (
              <Tab key={tool} value={tool}>
                {t(toolTabs[tool])}
              </Tab>
            ))}
        </TabList>
        <TabPanel className={styles.liveWorkTab}>
          {visitedResults && (
            <div hidden={activePanel !== "results"}>
              <Suspense fallback={null}>
                <VoiceWorkResults
                  rows={items.map((item) => ({
                    id: item.id,
                    title: item.title,
                    status: item.status,
                    statusLabel: t(item.label),
                    source: t(workSource(item)),
                  }))}
                  modelLayout={modelLayout}
                  selectedId={selected?.id}
                  onSelect={(id) => {
                    setFilter("all");
                    setSource("all");
                    setQuery("");
                    setSelectedId(id);
                    setPanel("activity");
                  }}
                />
              </Suspense>
            </div>
          )}
          {activePanel === "activity" ? (
            <>
              {items.length > 0 && (
                <div className={styles.liveWorkTools}>
                  <Suspense fallback={null}>
                    <VoiceWorkSummary counts={counts} selected={filter} onSelect={setFilter} />
                  </Suspense>
                  {items.length > 0 && (
                    <Button
                      variant="ghost"
                      startIcon={<ListEnd className="icon-sm" />}
                      pressed={!selectedId}
                      selected={!selectedId}
                      onClick={() => setSelectedId(selectedId ? undefined : selected?.id)}
                    >
                      {t("Follow")}
                    </Button>
                  )}
                </div>
              )}
              <div className={styles.liveWorkSplit}>
                <section aria-label={t("Recent activity")} className={styles.liveWorkList}>
                  {sources.length > 1 && (
                    <Select
                      label={t("Source")}
                      hideLabel
                      value={normalizedSource}
                      options={[
                        { value: "all", label: t("All sources") },
                        ...sources.map((value) => ({ value, label: t(value) })),
                      ]}
                      onValueChange={(value) => {
                        setSource(value);
                        setFilter("all");
                      }}
                    />
                  )}
                  {items.length > 1 && (
                    <SearchInput
                      type="search"
                      appearance="field"
                      aria-label={t("Search")}
                      placeholder={t("Search")}
                      value={query}
                      onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                  )}
                  <div className={styles.liveWorkRows}>
                    {shown.map((item) => (
                      <ListRow
                        key={item.id}
                        className={styles.liveWorkRow}
                        selected={selected?.id === item.id}
                        aria-pressed={selected?.id === item.id}
                        icon={
                          item.kind === "command" ? (
                            <Terminal className="icon-sm" />
                          ) : item.kind === "job" || item.kind === "tracked" ? (
                            <SquareKanban className="icon-sm" />
                          ) : (
                            <AudioLines className="icon-sm" />
                          )
                        }
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span className={styles.liveWorkRowText}>
                          <Text as="span" truncate>
                            {item.title}
                          </Text>
                          <Text
                            as="span"
                            size="caption"
                            tone="secondary"
                            className={styles.liveWorkState}
                          >
                            <StatusDot tone={commandStatus[item.status][1]} />
                            {t(item.label)}
                          </Text>
                        </span>
                      </ListRow>
                    ))}
                    {shown.length === 0 && (
                      <Text tone="secondary">
                        {t(items.length ? "No results" : "No activity yet")}
                      </Text>
                    )}
                  </div>
                </section>
                {selected && (
                  <WorkDetail
                    key={selected.id}
                    item={selected}
                    onStopWaiting={onStopWaiting}
                    onOpenTrackedWork={onOpenTrackedWork}
                  />
                )}
              </div>
            </>
          ) : activePanel === "compare" ? (
            <VoiceWorkComparison
              results={commandResults.map((item) => ({
                id: item.id,
                title: item.title,
                status: t(item.label),
                output: [item.inspection.error, item.inspection.output]
                  .filter(Boolean)
                  .join("\n\n"),
              }))}
            />
          ) : activePanel === "draft" && draft !== undefined ? (
            <VoiceWorkDraft
              draft={draft}
              onDraftChange={onDraftChange}
              evidence={
                selected
                  ? {
                      title: selected.title,
                      status: t(selected.label),
                      output:
                        selected.kind === "command"
                          ? [selected.inspection.error, selected.inspection.output]
                              .filter(Boolean)
                              .join("\n\n")
                          : selected.kind === "job"
                            ? selected.job.summary
                            : selected.kind === "tracked"
                              ? selected.work.summary
                              : undefined,
                    }
                  : undefined
              }
            />
          ) : session && renderTool && activePanel in toolTabs ? (
            renderTool(activePanel as VoiceWorkspaceTool, session)
          ) : null}
        </TabPanel>
      </Tabs>
    </section>
  );
}

function WorkDetail({
  item,
  onStopWaiting,
  onOpenTrackedWork,
}: {
  item: ReturnType<typeof workItems>[number];
  onStopWaiting: (id: string) => void;
  onOpenTrackedWork?: (work: VoiceWorkspaceTrackedWork) => void;
}) {
  const output = item.kind === "command" ? item.inspection : undefined;
  return (
    <section
      {...surfaceAttributes({ frame: "pane", edge: "responsive-start" }, styles.liveWorkDetail)}
      aria-label={t("Details")}
    >
      <div className={styles.liveWorkHeader}>
        <Heading as="h3" size="page">
          {item.title}
        </Heading>
        {output && <CopyButton iconOnly label={t("Copy command")} text={output.command.text} />}
      </div>
      <Text tone="secondary">
        {t(workSource(item))} · {t(item.label)}
      </Text>
      {item.kind === "voice" && (
        <>
          <Text tone="secondary">{item.entry.target}</Text>
          {(item.entry.state === "running" || item.entry.state === "waiting-owner") && (
            <Button onClick={() => onStopWaiting(item.entry.id)}>{t("Stop waiting")}</Button>
          )}
          {item.entry.state === "uncertain" && (
            <Text tone="warning">{t("Result unknown. Check before retrying.")}</Text>
          )}
        </>
      )}
      {item.kind === "job" && (
        <>
          <Text tone="secondary">{item.job.projectNames.join(", ")}</Text>
          {item.job.summary && <Text>{item.job.summary}</Text>}
          {item.job.progress.total > 0 && (
            <Text tone="secondary">
              {t("Progress")} · {item.job.progress.done}/{item.job.progress.total}
            </Text>
          )}
        </>
      )}
      {item.kind === "tracked" && (
        <>
          {item.work.summary && <Text>{item.work.summary}</Text>}
          {item.work.progress && (
            <Text tone="secondary">
              {t("Progress")} · {item.work.progress.done}/{item.work.progress.total}
            </Text>
          )}
          {onOpenTrackedWork && (
            <Button
              onClick={() => onOpenTrackedWork(item.work)}
              endIcon={<ExternalLink className="icon-sm" />}
            >
              {t("Open")}
            </Button>
          )}
        </>
      )}
      {output && (
        <>
          <div className={styles.liveWorkHeader}>
            <Heading as="h4" size="caption">
              {t("Output")}
            </Heading>
            {(output.output || output.error) && (
              <CopyButton
                iconOnly
                label={t("Copy output")}
                text={[output.error, output.output].filter(Boolean).join("\n\n")}
              />
            )}
          </div>
          {output.error && (
            <OutputBlock frame="filled" tone="danger">
              {output.error}
            </OutputBlock>
          )}
          {output.output && <OutputBlock frame="filled">{output.output}</OutputBlock>}
          {output.outputTruncated && (
            <Text tone="secondary">
              {t("Output was shortened; the full text may not be available.")}
            </Text>
          )}
          {!output.error && !output.output && (
            <Text tone="secondary">{t(emptyOutput[output.lifecycle])}</Text>
          )}
        </>
      )}
    </section>
  );
}
