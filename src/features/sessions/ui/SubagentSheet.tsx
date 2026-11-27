import { surfaceAttributes } from "../../../shared/ui/Surface";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Code } from "../../../shared/ui/Code";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { Surface } from "../../../shared/ui/Surface";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useFollowBottom } from "../hooks/useFollowBottom";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useLocale, useT } from "../../../shared/i18n";
import {
  useCallback,
  useContext,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  CornerDownRight,
  Maximize2,
  Minimize2,
  Square,
} from "../../../shared/ui/icons";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { AnsiText } from "../../../shared/ui/AnsiText";
import { blockLifecycle } from "../model/activityDock";
import { delegatedBriefText } from "../model/delegatedAgents";
import { commandCopyText, emptyOutputReason, inspectCommand } from "../model/commandInspection";
import type { AgentStep, Block } from "../model/session";
import type { DelegationKind } from "../../../shared/model/host-contracts/delegation";
import { isSubagentBlock, subagentName, subagentReport } from "../model/transcriptActivity";
import { SubagentReport, SubagentStateLine, runLabelWith } from "./SubagentAnatomy";
import { ActivityRow } from "./AgentTranscriptActivity";
import { blockForStep } from "../model/agentStepBlocks";
import { sessionToolFilePaths } from "../model/sessionToolPaths";
import { TranscriptToolPaths } from "./TranscriptToolPaths";
import { AgentMarkdown } from "./AgentMarkdown";
import { VIEW_SUBAGENT_EVENT } from "./subagentFocus";
import { useStopRequests } from "./useStopRequests";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Sheet } from "../../../shared/ui/Sheet";
import styles from "./SubagentSheet.module.css";
import { useSubagentModelName } from "../model/reactiveReads";
import { SubagentMessageForm, type SubagentRelay } from "./SubagentMessageForm";
import {
  TimelineInput,
  groupRounds,
  hasRoundHistory,
  isTimelineReport,
  roundSummary,
  stepRounds,
  timelineMarkdown,
} from "./SubagentSheetTimeline";

export type { SubagentRelay } from "./SubagentMessageForm";

const AGENT_PANEL_RESIZE = { min: 360, max: 1200, defaultSize: 544 };

/**
 * Which delegated run's panel is open in a session pane. The pane that owns the
 * block answers `requestViewSubagent`; panes that do not have it ignore it, so
 * one request opens one panel and asking for another agent swaps the content.
 */
export function useSubagentSheet(blocks: Block[], visible: boolean) {
  const [openId, setOpenId] = useState<string | null>(null);
  const blocksRef = useRef(blocks);
  useLayoutEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);
  // Focus returns to the opener in the shared `Sheet` when this panel closes.
  const open = useCallback((blockId: string) => setOpenId(blockId), []);
  const close = () => setOpenId(null);

  useEffect(() => {
    if (!visible) return;
    const onView = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id !== "string") return;
      const block = blocksRef.current.find((entry) => entry.id === id);
      if (block && isSubagentBlock(block)) open(id);
    };
    window.addEventListener(VIEW_SUBAGENT_EVENT, onView);
    return () => window.removeEventListener(VIEW_SUBAGENT_EVENT, onView);
  }, [visible, open]);

  const block = openId ? blocks.find((entry) => entry.id === openId) : undefined;
  // The run vanished (a rewind, a deleted turn): nothing left to show.
  if (openId !== null && !block) setOpenId(null);

  return { block, open, close };
}

/** The follow flag is a ref that `useFollowBottom` owns; writes go through here. */
function setFollowing(following: { current: boolean }, value: boolean) {
  following.current = value;
}

/** Steps shown at first, and added by each "Show earlier steps". */
const STEP_PAGE = 60;

/**
 * One subagent's run in a sheet over the session pane, read as a conversation:
 * the prompt it was given, what it said, each call with what it returned, and
 * its report. It reads the same block the transcript row does, so it fills in
 * live, and renders calls and thoughts through the transcript's own rows. There
 * Requests to message an agent use the parent's normal submission path.
 */
export function SubagentSheet({
  block,
  busy,
  visible,
  cwd,
  onClose,
  onStop,
  onShowInTranscript,
  onLoadRemoteBlock,
  onOpenFile,
  onOpenDiff,
  relay,
  composer,
  requests,
  agentRole,
  nested,
  back,
  needsInput,
}: {
  block: Block;
  busy: boolean;
  visible: boolean;
  cwd?: string;
  onClose: () => void;
  /** Present when the harness can stop this one run without the whole turn. */
  onStop?: () => Promise<void>;
  /** Returns false when the block could not be found; the sheet then stays open. Absent for a delegated child, which is not in the transcript. */
  onShowInTranscript?: (blockId: string) => boolean | void;
  /** The transcript's authorized full-block loader, for blocks held as remote summaries. */
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  relay?: SubagentRelay;
  composer?: ReactNode;
  requests?: ReactNode;
  agentRole?: DelegationKind;
  /** The subagents this run started itself, above its trail. */
  nested?: ReactNode;
  /** This run was started by another subagent: return to that one's sheet. */
  back?: { name: string; open: () => void };
  /** The child waits on the user while running, as the dock shows it. */
  needsInput?: boolean;
}) {
  const t = useT();
  const command = !isSubagentBlock(block);
  const name = command ? t("Command details") : subagentName(block);
  const subagentModel = useSubagentModelName(block);
  const model = command ? undefined : subagentModel;
  const run = block.agentRun;
  const running = blockLifecycle(block, busy) === "running";
  // Showing in the transcript can fail (the block is not rendered there); the
  // sheet stays open with the reason instead of silently losing its context.
  const [showFailedFor, setShowFailedFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const showFailed = showFailedFor === block.id;
  const steps = run?.steps ?? [];
  const stops = useStopRequests();
  const stopKey = block.tool?.callId ?? block.id;
  const stopping = stops.stopping.has(stopKey);
  // The panel sits beside the transcript: its links search this run's files first.
  const parentToolPaths = useContext(TranscriptToolPaths);
  const toolPaths = useStableCallback(() => [
    ...sessionToolFilePaths([block], cwd),
    ...(parentToolPaths?.() ?? []),
  ]);

  return (
    <TranscriptToolPaths.Provider value={toolPaths}>
      <Sheet
        padding="none"
        modal={false}
        anchor="container"
        side="end"
        surface={command ? "floating" : "chat"}
        resizable={command ? undefined : AGENT_PANEL_RESIZE}
        expanded={!command && expanded}
        open={visible}
        title={
          command
            ? name
            : agentRole === "advisor"
              ? `${t("Advisor")}: ${name}`
              : t("Subagent: {p0}", { p0: name })
        }
        closeLabel={command ? t("Close command panel") : t("Close agent panel")}
        escapeScope="[data-session-drop]"
        scroll="none"
        bodyClassName={`${styles.layout} font-sans`}
        bodyText={{ size: "body" }}
        onClose={onClose}
        headerActions={
          <>
            {!command ? (
              <Button
                iconOnly
                size="sm"
                variant="ghost"
                label={expanded ? t("Restore") : t("Expand")}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? (
                  <Minimize2 className="icon-sm" aria-hidden />
                ) : (
                  <Maximize2 className="icon-sm" aria-hidden />
                )}
              </Button>
            ) : null}
            {back ? (
              <Button
                iconOnly
                label={t("Back")}
                variant="ghost"
                type="button"
                tooltip={back.name}
                className="shrink-0"
                data-subagent-back
                onClick={back.open}
              >
                <ArrowLeft className="icon-sm" aria-hidden />
              </Button>
            ) : null}
            <CopyTranscriptButton block={block} busy={busy} status={runLabelWith(block, busy, t)} />
            {onStop && running ? (
              <Button
                className="shrink-0"
                variant="ghost"
                type="button"
                loading={stopping}
                loadingLabel={t("Stopping…")}
                startIcon={<Square className="icon-sm" aria-hidden />}
                tooltip={
                  stops.failed.has(stopKey)
                    ? t("Could not stop it. Try again.")
                    : command
                      ? t("Stop this command")
                      : agentRole === "advisor"
                        ? t("Stop")
                        : t("Stop this subagent")
                }
                onClick={() => stops.request(stopKey, onStop)}
              >
                {stops.failed.has(stopKey) ? t("Could not stop. Retry") : t("Stop")}
              </Button>
            ) : null}
            {onShowInTranscript ? (
              <Button
                iconOnly
                label={t("Show in transcript")}
                variant="ghost"
                type="button"
                onClick={() => {
                  setShowFailedFor(onShowInTranscript(block.id) === false ? block.id : null);
                }}
                tooltip={command ? undefined : t("Scroll to this agent in the transcript")}
                className="shrink-0"
              >
                <CornerDownRight className="icon-sm" aria-hidden />
              </Button>
            ) : null}
          </>
        }
        headerBelow={
          <SubagentStateLine
            block={block}
            busy={busy}
            steps={steps}
            model={model}
            needsInput={needsInput}
          />
        }
      >
        {showFailed ? (
          <div className="shrink-0 px-4 pt-2">
            <InlineMessage tone="warning">
              {t("Could not find this item in the transcript. It stays open here.")}
            </InlineMessage>
          </div>
        ) : null}
        {!command && nested ? (
          <div data-chat-column className="mx-auto w-full shrink-0">
            {nested}
          </div>
        ) : null}
        {command ? (
          <CommandDetails
            key={block.id}
            block={block}
            busy={busy}
            cwd={cwd}
            onLoadRemoteBlock={onLoadRemoteBlock}
          />
        ) : (
          <SubagentTrail
            key={block.id}
            block={block}
            steps={steps}
            running={running}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        )}
        {!command && (requests || composer) ? (
          <div className={styles.requests}>
            <ScrollArea gutter="stable" className="min-h-0 flex-1">
              <div data-chat-column className="mx-auto w-full min-w-0">
                {requests}
                {composer ?? (relay ? <SubagentMessageForm name={name} relay={relay} /> : null)}
              </div>
            </ScrollArea>
          </div>
        ) : !command && relay ? (
          <SubagentMessageForm name={name} relay={relay} />
        ) : !command ? (
          <Text as="p" size="caption" tone="secondary" className="shrink-0 px-4 py-2">
            {t("Messaging is unavailable in this conversation.")}
          </Text>
        ) : null}
      </Sheet>
    </TranscriptToolPaths.Provider>
  );
}

/** Copy text for a command, stating when the retained body is only a summary or shortened. */
function commandDetailsCopyText(
  block: Block,
  busy: boolean,
  status: string,
  t: ReturnType<typeof useT>,
): string {
  const inspection = inspectCommand(block, busy);
  const text = commandCopyText(inspection, status);
  const notices = [
    inspection.remote
      ? t("[Only a summary of the output is kept here; the full output was not loaded.]")
      : null,
    inspection.outputTruncated
      ? t("[Output was shortened; the full text may not be available.]")
      : null,
    inspection.command.truncated
      ? t("[Command text was shortened to keep this conversation responsive.]")
      : null,
  ].filter((notice): notice is string => !!notice);
  return notices.length ? [text, ...notices].join("\n\n") : text;
}

/** Local state for loading a remote summary into the full block. */
type RemoteLoad = { status: "idle" | "loading" | "failed"; revision: number };

/**
 * Command details, in reading order: status is in the header, then the command
 * (exact text on demand), the session context (subordinate), and the output as
 * the one main reading area. Updates from the same live block as the dock.
 */
function CommandDetails({
  block,
  busy,
  cwd,
  onLoadRemoteBlock,
}: {
  block: Block;
  busy: boolean;
  cwd?: string;
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
}) {
  const t = useT();
  const inspection = inspectCommand(block, busy);
  const { command, error, output, remote } = inspection;
  const reason = emptyOutputReason(inspection);
  const [commandOpen, setCommandOpen] = useState(false);
  const longCommand = command.text.length > 240 || command.text.split("\n").length > 3;

  // Remote summary: pending/error/retry are local; a result only counts for the
  // revision it was requested for, and never after the command was swapped.
  const [load, setLoad] = useState<RemoteLoad>({ status: "idle", revision: 0 });
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const revision = remote?.revision;
  const loadState = revision !== undefined && load.revision === revision ? load.status : "idle";
  const loadFull = () => {
    if (!onLoadRemoteBlock || revision === undefined || loadState === "loading") return;
    const requested = ++generation.current;
    setLoad({ status: "loading", revision });
    const settle = (status: RemoteLoad["status"]) => {
      if (generation.current !== requested) return;
      setLoad({ status, revision });
    };
    try {
      void Promise.resolve(onLoadRemoteBlock(block.id, revision)).then(
        () => settle("idle"),
        () => settle("failed"),
      );
    } catch {
      settle("failed");
    }
  };

  // Follow the newest output until the reader scrolls up or selects text.
  const scroller = useRef<HTMLDivElement>(null);
  const following = useFollowBottom(scroller, true, output, 32, false);
  const [behind, setBehind] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const sync = () => setBehind(el.scrollHeight - el.scrollTop - el.clientHeight > 32);
    const onSelection = () => {
      const selection = document.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        el.contains(selection.anchorNode)
      ) {
        setFollowing(following, false);
        setBehind(true);
      }
    };
    el.addEventListener("scroll", sync, { passive: true });
    document.addEventListener("selectionchange", onSelection);
    return () => {
      el.removeEventListener("scroll", sync);
      document.removeEventListener("selectionchange", onSelection);
    };
  }, [following]);
  // New output while the reader is paused keeps the jump control visible.
  useEffect(() => {
    const el = scroller.current;
    if (el && !following.current) {
      setBehind(el.scrollHeight - el.scrollTop - el.clientHeight > 32);
    }
  }, [output, following]);
  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    setFollowing(following, true);
    el.scrollTop = el.scrollHeight;
    setBehind(false);
  };

  // Silence is only claimed when the retained body is complete. A remote summary
  // or shortened body cannot establish that the command printed nothing.
  const unavailableText =
    reason && !error
      ? remote
        ? t(
            "The output is not loaded here. Only a summary is kept; load the full output to read it.",
          )
        : inspection.outputTruncated
          ? t("The output was shortened and nothing is retained here, so it cannot be shown.")
          : null
      : null;
  const emptyText =
    unavailableText ??
    (reason === "running"
      ? t("Running. No output has been reported yet; new output appears here.")
      : reason === "done"
        ? t("Finished. The command reported no output.")
        : reason === "stopped"
          ? t("Stopped before it reported any output.")
          : reason === "interrupted"
            ? t("Interrupted before it reported any output. Its final state was not reported.")
            : reason === "failed" && !error
              ? t("Failed without reporting output.")
              : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-1 pb-3">
      <section
        aria-label={t("Command")}
        className="flex max-h-[min(22rem,55dvh)] min-h-0 shrink flex-col gap-1 overflow-y-auto overscroll-contain"
      >
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>{t("Command")}</SectionLabel>
          {longCommand ? (
            <Button
              variant="ghost"
              type="button"
              aria-expanded={commandOpen}
              onClick={() => setCommandOpen((value) => !value)}
            >
              {commandOpen ? t("Show less") : t("Show full command")}
            </Button>
          ) : null}
        </div>
        <OutputBlock
          tabIndex={0}
          tone="inherit"
          density="comfortable"
          frame="card"
          scroll
          {...surfaceAttributes(
            { focusRing: "inset", variant: "card" },
            `break-words ${commandOpen || !longCommand ? "max-h-[min(16rem,32dvh)]" : "max-h-20"}`,
          )}
        >
          {command.text}
        </OutputBlock>
        {command.truncated ? (
          <Text as="p" size="caption" tone="secondary">
            {t("Command text was shortened to keep this conversation responsive.")}
          </Text>
        ) : null}
        {cwd ? (
          <Text as="p" size="caption" tone="secondary" className="wrap-anywhere">
            <span>{t("Session working directory")}: </span>
            <Code className="select-text">{cwd}</Code>
          </Text>
        ) : null}
      </section>
      <section aria-label={t("Output")} className="relative flex min-h-32 flex-1 flex-col gap-1">
        <SectionLabel>{t("Output")}</SectionLabel>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* The one scroll owner of the sheet: error and output read in one quiet
              panel. Always mounted: the follow hook attaches to this element once. */}
          <ScrollArea
            axis="both"
            gutter="stable"
            ref={scroller}
            tabIndex={0}
            {...surfaceAttributes(
              { frame: "card", edge: "all", variant: "card", focusRing: "inset" },
              "min-h-0 flex-1 overflow-auto overscroll-none rounded-(--ui-radius-card) border-(--ui-card-border)",
            )}
          >
            <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
              {error ? (
                <OutputBlock tone="danger" density="comfortable">
                  <AnsiText text={error} />
                </OutputBlock>
              ) : null}
              {output ? (
                <OutputBlock tone="inherit" density="comfortable">
                  <AnsiText text={output} />
                </OutputBlock>
              ) : emptyText ? (
                <Text as="p" size="caption" tone="secondary">
                  {emptyText}
                </Text>
              ) : null}
            </div>
          </ScrollArea>
          {behind && output ? (
            <Button
              className="absolute right-3 bottom-3"
              variant="secondary"
              type="button"
              onClick={jumpToLatest}
            >
              <ArrowDown className="icon-sm" strokeWidth={1.75} />
              {t("Jump to latest")}
            </Button>
          ) : null}
        </div>
        {inspection.outputTruncated ? (
          <Text as="p" size="caption" tone="secondary" className="shrink-0">
            {t("Output was shortened; the full text may not be available.")}
          </Text>
        ) : null}
        {remote ? (
          <Text
            as="div"
            size="caption"
            tone="secondary"
            className="flex shrink-0 flex-wrap items-center gap-2"
          >
            <span>{t("Only a summary of this output is kept here.")}</span>
            {onLoadRemoteBlock ? (
              <Button
                variant="ghost"
                type="button"
                loading={loadState === "loading"}
                onClick={loadFull}
              >
                {loadState === "failed"
                  ? t("Retry")
                  : t("Load full output ({p0} KB)", {
                      p0: Math.max(1, Math.ceil(remote.bytes / 1024)),
                    })}
              </Button>
            ) : null}
            {loadState === "loading" ? (
              <LoadingText>{t("Loading full output…")}</LoadingText>
            ) : null}
            {loadState === "failed" ? (
              <InlineError>{t("Could not load the full output.")}</InlineError>
            ) : null}
          </Text>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Copies the run (Markdown for a subagent, exact command + status + output for a
 * command). One copy at a time, results ignored once the selected run changed,
 * the confirmation resets after the copy settles, and a failure stays visible
 * until retried.
 */
function CopyTranscriptButton({
  block,
  busy,
  status,
}: {
  block: Block;
  busy: boolean;
  status: string;
}) {
  const t = useT();
  const command = !isSubagentBlock(block);
  const label = command ? t("Copy details") : t("Copy transcript");
  // A different run invalidates any copy in flight and any shown outcome (resetKeys); streaming
  // content of the same run does not, because the text is read when the click happens.
  const copyText = useStableCallback(() => {
    const text = command
      ? commandDetailsCopyText(block, busy, status, t)
      : timelineMarkdown(block, status);
    // Nothing to copy: show the failed state instead of a false "Copied".
    if (!text) throw new Error("Nothing to copy");
    return text;
  });
  return (
    <CopyButton
      iconOnly
      className="shrink-0"
      type="button"
      label={label}
      tooltip={command ? label : t("{p0} (Markdown)", { p0: label })}
      resetKeys={[block.id]}
      text={copyText}
    />
  );
}

/** What the subagent was asked, clamped until the reader opens it. */
function PromptCard({ prompt }: { prompt: string }) {
  const t = useT();
  const assignment = delegatedBriefText(prompt);
  return (
    <Surface as="section" variant="card" padding="sm" aria-label={t("Prompt")} className="mb-2">
      <Text as="div" size="secondary" tone="inherit" leading="normal">
        <SectionLabel>{t("Prompt")}</SectionLabel>
        <ClampText lines={6} moreLabel={assignment ? t("Show more") : t("Show full prompt")}>
          <Text
            as="p"
            size="inherit"
            tone="secondary"
            className="min-w-0 whitespace-pre-wrap break-words"
          >
            {assignment ?? prompt}
          </Text>
        </ClampText>
        {assignment ? (
          <Disclosure variant="row" summary={t("Show full prompt")}>
            <Text
              as="p"
              size="secondary"
              tone="secondary"
              className="min-w-0 whitespace-pre-wrap break-words"
            >
              {prompt}
            </Text>
          </Disclosure>
        ) : null}
      </Text>
    </Surface>
  );
}

/**
 * One step of the conversation. Prose reads in full, like a chat reply; calls
 * and thoughts use the transcript's rows, which open to input and output.
 */
const SheetStep = memo(function SheetStep({
  step,
  live,
  cwd,
  onOpenFile,
  onOpenDiff,
}: {
  step: AgentStep;
  live: boolean;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  const nestedBlock = blockForStep(step);
  const nestedModel = useSubagentModelName(nestedBlock);
  if (step.agentRun) {
    const nestedRunning = blockLifecycle(nestedBlock, live) === "running";
    return (
      <Disclosure
        data-nested-subagent={step.id}
        variant="row"
        summary={
          <span className="flex min-w-0 flex-col gap-1">
            <Text weight="medium">{subagentName(nestedBlock)}</Text>
            <SubagentStateLine
              block={nestedBlock}
              busy={live}
              steps={step.agentRun.steps}
              model={nestedModel}
            />
          </span>
        }
      >
        <SubagentTrail
          block={nestedBlock}
          steps={step.agentRun.steps}
          running={nestedRunning}
          cwd={cwd}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      </Disclosure>
    );
  }
  if (step.input) return <TimelineInput step={step} input={step.input} />;
  if (step.kind === "message") {
    return (
      <div data-timeline-message={step.id} className="min-w-0 py-1">
        <AgentMarkdown text={step.text} cwd={cwd} onOpenFile={onOpenFile} />
      </div>
    );
  }
  return (
    <ActivityRow
      block={blockForStep(step)}
      cwd={cwd}
      live={live}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
});

/** Keyed by run, so each agent starts pinned to its newest step. */
function SubagentTrail({
  block,
  steps,
  running,
  cwd,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  steps: AgentStep[];
  running: boolean;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  // Follow the newest step until the reader scrolls up; scrolling back to the
  // end picks the follow up again.
  const report = subagentReport(block);
  const prompt = block.agentRun?.prompt?.trim();
  // A run can hold hundreds of steps. Rows are variable-height and open on
  // demand, so rather than virtualise them the newest page is rendered and the
  // older ones sit behind a button.
  const [shown, setShown] = useState(STEP_PAGE);
  const subagents = steps.filter((step) => step.agentRun);
  const activeSubagents = subagents.filter(
    (step) => blockLifecycle(blockForStep(step), running) === "running",
  ).length;
  // The closing report is the latest round's; an earlier round that ended on the same
  // words keeps its own row.
  const transcriptSteps = steps.filter((step) => !step.input || step.round !== undefined);
  const unlinkedInputs = steps.flatMap((step) =>
    step.input && step.round === undefined ? [{ step, input: step.input }] : [],
  );
  const stepRound = stepRounds(transcriptSteps);
  const latestRound = stepRound[stepRound.length - 1];
  const trail = transcriptSteps.filter(
    (step, index) =>
      !step.agentRun &&
      (!report || stepRound[index] !== latestRound || !isTimelineReport(step, report)),
  );
  // Rounds of a delegated conversation: earlier ones open on demand, the latest in
  // full. A run of one round keeps the plain trail. Open state lives here, so live
  // updates (new ids, new steps) never close what the reader opened.
  const [openRounds, setOpenRounds] = useState<readonly number[]>([]);
  const rounds = hasRoundHistory(trail) ? groupRounds(trail) : undefined;
  const earlier = rounds ? rounds.slice(0, -1) : [];
  const current = rounds ? rounds[rounds.length - 1].steps : trail;
  const visible = current.length > shown ? current.slice(current.length - shown) : current;
  const hidden = current.length - visible.length;

  const following = useFollowBottom(scroller, true, steps, 32, false, report);

  return (
    <ScrollArea
      gutter="stable"
      ref={scroller}
      data-subagent-trail
      className="min-h-0 flex-1 overflow-y-auto overscroll-none"
    >
      <div data-chat-column className="mx-auto flex w-full min-w-0 flex-col gap-1 px-4 py-3">
        {prompt ? <PromptCard prompt={prompt} /> : null}
        {subagents.length > 0 ? (
          <section aria-label={t("Subagents")}>
            <SectionLabel>
              {t("Subagents · {p0} running · {p1} past", {
                p0: activeSubagents,
                p1: subagents.length - activeSubagents,
              })}
            </SectionLabel>
            {subagents.map((step) => (
              <SheetStep
                key={step.id}
                step={step}
                live={running}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
              />
            ))}
          </section>
        ) : null}
        {visible.length === 0 && !report && subagents.length === 0 && !unlinkedInputs.length ? (
          <Text as="p" size="caption" tone="secondary" className="pt-1">
            {running ? t("Waiting for the first step.") : t("This agent did not report any steps.")}
          </Text>
        ) : null}
        {earlier.map((group) => (
          <Disclosure
            key={group.round}
            data-timeline-round={group.round}
            variant="row"
            open={openRounds.includes(group.round)}
            onOpenChange={(open) =>
              setOpenRounds((rounds) =>
                open
                  ? rounds.includes(group.round)
                    ? rounds
                    : [...rounds, group.round]
                  : rounds.filter((entry) => entry !== group.round),
              )
            }
            summary={
              <span className="flex min-w-0 flex-col">
                <Text weight="medium">{t("Round {p0}", { p0: group.round })}</Text>
                <Text size="caption" tone="secondary" truncate>
                  {roundSummary(group.steps)}
                </Text>
              </span>
            }
          >
            {openRounds.includes(group.round)
              ? group.steps.map((step) => (
                  <SheetStep
                    key={step.id}
                    step={step}
                    live={false}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    onOpenDiff={onOpenDiff}
                  />
                ))
              : null}
          </Disclosure>
        ))}
        {rounds ? (
          <div data-timeline-round={rounds[rounds.length - 1].round}>
            <SectionLabel>{t("Round {p0}", { p0: rounds[rounds.length - 1].round })}</SectionLabel>
          </div>
        ) : null}
        {hidden > 0 ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setFollowing(following, false);
              setShown((count) => count + STEP_PAGE);
            }}
            className="self-start"
          >
            {t("Show earlier steps ({p0})", { p0: hidden })}
          </Button>
        ) : null}
        {visible.map((step) => (
          <SheetStep
            key={step.id}
            step={step}
            live={running}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        ))}
        <SubagentReport block={block} cwd={cwd} onOpenFile={onOpenFile} className="mt-3" />
        {unlinkedInputs.map(({ step, input }) => (
          <TimelineInput key={step.id} step={step} input={input} />
        ))}
      </div>
    </ScrollArea>
  );
}
