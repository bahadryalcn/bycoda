import { useFollowBottom } from "../hooks/useFollowBottom";
import { useLocale, useT } from "../../../shared/i18n";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, Copy, CornerDownRight, Square } from "../../../shared/ui/icons";
import { copyText } from "../../../platform/tauri/clipboard";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { Alert } from "../../../shared/ui/Alert";
import { agentRunMarkdown, isReportStep } from "../model/agentRunMarkdown";
import { blockLifecycle } from "../model/activityDock";
import { commandCopyText, emptyOutputReason, inspectCommand } from "../model/commandInspection";
import type { AgentStep, Block } from "../model/session";
import { isSubagentBlock, subagentName, subagentReport } from "../model/transcriptActivity";
import { SubagentReport, SubagentStateLine, runLabel } from "./SubagentAnatomy";
import { ActivityRow } from "./AgentTranscriptActivity";
import { blockForStep } from "./agentStepBlocks";
import { AgentMarkdown } from "./AgentMarkdown";
import { VIEW_SUBAGENT_EVENT } from "./subagentFocus";
import { useStopRequests } from "./useStopRequests";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Sheet } from "../../../shared/ui/Sheet";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { TextareaField } from "../../../shared/ui/TextareaField";
import styles from "./SubagentSheet.module.css";
import { useSubagentModelName } from "../model/reactiveReads";

export type SubagentRelay = {
  draft: string;
  status?: "accepted" | "rejected";
  blockedReason?: string;
  setDraft: (draft: string) => void;
  send: () => void;
  onOpenConversation: () => void;
};

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
  // Where focus was when the panel opened, so closing puts it back.
  const returnFocus = useRef<HTMLElement | null>(null);

  const open = useCallback((blockId: string) => {
    setOpenId((current) => {
      if (current === null) {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      return blockId;
    });
  }, []);

  const close = useCallback(() => {
    setOpenId((current) => {
      if (current === null) return null;
      const target = returnFocus.current;
      returnFocus.current = null;
      // After the panel has gone, so it cannot reclaim focus first.
      queueMicrotask(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
      return null;
    });
  }, []);

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
  // The panel is gone without `close`; hand focus back once it has unmounted.
  useEffect(() => {
    if (openId !== null) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [openId]);

  return { block, open, close };
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
}: {
  block: Block;
  busy: boolean;
  visible: boolean;
  cwd?: string;
  onClose: () => void;
  /** Present when the harness can stop this one run without the whole turn. */
  onStop?: () => Promise<void>;
  /** Returns false when the block could not be found; the sheet then stays open. */
  onShowInTranscript: (blockId: string) => boolean | void;
  /** The transcript's authorized full-block loader, for blocks held as remote summaries. */
  onLoadRemoteBlock?: (blockId: string, revision: number) => Promise<void> | void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  relay?: SubagentRelay;
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
  const showFailed = showFailedFor === block.id;
  const steps = run?.steps ?? [];
  const stops = useStopRequests();
  const stopKey = block.tool?.callId ?? block.id;
  const stopping = stops.stopping.has(stopKey);

  return (
    <Sheet
      modal={false}
      anchor="container"
      side="end"
      open={visible}
      title={command ? name : t("Subagent: {p0}", { p0: name })}
      closeLabel={t(command ? "Close command panel" : "Close agent panel")}
      escapeScope="[data-session-drop]"
      scroll="none"
      bodyClassName={`${styles.layout} font-sans text-ui-body`}
      onClose={onClose}
      headerActions={
        <>
          <CopyTranscriptButton block={block} busy={busy} status={runLabel(block, busy)} />
          {onStop && running ? (
            <Button
              className="shrink-0"
              variant="ghost"
              type="button"
              disabled={stopping}
              tooltip={
                stops.failed.has(stopKey)
                  ? t("Could not stop it. Try again.")
                  : t(command ? "Stop this command" : "Stop this subagent")
              }
              onClick={() => stops.request(stopKey, onStop)}
            >
              <Square className="icon-sm" aria-hidden />
              {stopping
                ? t("Stopping…")
                : stops.failed.has(stopKey)
                  ? t("Could not stop. Retry")
                  : t("Stop")}
            </Button>
          ) : null}
          <Button
            iconOnly
            label={t("Show in transcript")}
            variant="ghost"
            type="button"
            onClick={() => {
              setShowFailedFor(onShowInTranscript(block.id) === false ? block.id : null);
            }}
            tooltip={
              command ? t("Show in transcript") : t("Scroll to this agent in the transcript")
            }
            className="shrink-0"
          >
            <CornerDownRight className="icon-sm" aria-hidden />
          </Button>
        </>
      }
      headerBelow={<SubagentStateLine block={block} busy={busy} steps={steps} model={model} />}
    >
      {showFailed ? (
        <div className="shrink-0 px-4 pt-2">
          <Alert tone="warning" inline>
            {t("Could not find this item in the transcript. It stays open here.")}
          </Alert>
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
      {!command && relay ? (
        <form
          className={`${styles.composer} flex shrink-0 flex-col gap-2 border-t border-(--ui-pane-border) px-4 py-3`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!relay.blockedReason && relay.draft.trim()) relay.send();
          }}
        >
          <TextareaField
            className={styles.message}
            label={t("Message for {p0}", { p0: name })}
            rows={2}
            value={relay.draft}
            onChange={(event) => relay.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!relay.blockedReason && relay.draft.trim()) relay.send();
              }
            }}
          />
          {relay.blockedReason ? (
            <p className="text-ui-caption text-(--ui-text-secondary)">{relay.blockedReason}</p>
          ) : null}
          <p
            role="status"
            className={`text-ui-caption empty:hidden ${
              relay.status === "rejected"
                ? "text-(--ui-tone-danger-fg)"
                : "text-(--ui-text-secondary)"
            }`}
          >
            {relay.status === "accepted"
              ? t("Request added to the main conversation. Delivery is not yet confirmed.")
              : relay.status === "rejected"
                ? t("Request was not accepted. Your message is kept here; try again.")
                : null}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <InfoPopover className="mr-auto" label={t("How messaging works")}>
              <p className="text-ui-secondary">
                {t(
                  "Via the main agent. Delivery depends on provider support; replies appear in the main conversation.",
                )}
              </p>
            </InfoPopover>
            <Button variant="ghost" onClick={relay.onOpenConversation}>
              {t("Open main conversation")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!!relay.blockedReason || !relay.draft.trim()}
            >
              {t("Relay via main agent")}
            </Button>
          </div>
        </form>
      ) : !command ? (
        <p className="shrink-0 px-4 py-2 text-ui-caption text-(--ui-text-secondary)">
          {t("Messaging is unavailable in this conversation.")}
        </p>
      ) : null}
    </Sheet>
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
  const inspection = useMemo(() => inspectCommand(block, busy), [block, busy]);
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
        following.current = false;
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
    following.current = true;
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
          <h3 className="text-ui-caption font-medium text-(--ui-text-secondary)">{t("Command")}</h3>
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
        <pre
          tabIndex={0}
          className={`select-text overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-lg border border-(--color-stroke) bg-(--ui-surface-panel) px-3 py-2 font-mono text-ui-caption leading-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-focus-ring-color) ${
            commandOpen || !longCommand ? "max-h-[min(16rem,32dvh)]" : "max-h-20"
          }`}
        >
          {command.text}
        </pre>
        {command.truncated ? (
          <p className="text-ui-caption text-(--ui-text-secondary)">
            {t("Command text was shortened to keep this conversation responsive.")}
          </p>
        ) : null}
        {cwd ? (
          <p className="text-ui-caption wrap-anywhere text-(--ui-text-secondary)">
            <span>{t("Session working directory")}: </span>
            <span className="select-text font-mono">{cwd}</span>
          </p>
        ) : null}
      </section>
      <section
        aria-label={t("Output")}
        className="relative flex min-h-[8rem] flex-1 flex-col gap-1"
      >
        <h3 className="text-ui-caption font-medium text-(--ui-text-secondary)">{t("Output")}</h3>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* The one scroll owner of the sheet: error and output read in one quiet
              panel. Always mounted: the follow hook attaches to this element once. */}
          <div
            ref={scroller}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-auto overscroll-none rounded-lg border border-(--color-stroke) bg-(--ui-surface-panel) [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-focus-ring-color)"
          >
            <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
              {error ? (
                <pre className="select-text whitespace-pre-wrap break-words font-mono text-ui-caption leading-5 text-(--ui-tone-danger-fg)">
                  {error}
                </pre>
              ) : null}
              {output ? (
                <pre className="select-text whitespace-pre-wrap break-words font-mono text-ui-caption leading-5">
                  {output}
                </pre>
              ) : emptyText ? (
                <p className="text-ui-caption text-(--ui-text-secondary)">{emptyText}</p>
              ) : null}
            </div>
          </div>
          {behind && output ? (
            <Button
              className="absolute right-3 bottom-3 shadow-(--ui-elevation-floating)"
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
          <p className="shrink-0 text-ui-caption text-(--ui-text-secondary)">
            {t("Output was shortened; the full text may not be available.")}
          </p>
        ) : null}
        {remote ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-ui-caption text-(--ui-text-secondary)">
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
                  : `${t("Load full output (")}${Math.max(1, Math.ceil(remote.bytes / 1024))}${t(" KB)")}`}
              </Button>
            ) : null}
            {loadState === "loading" ? (
              <LoadingText>{t("Loading full output…")}</LoadingText>
            ) : null}
            {loadState === "failed" ? (
              <InlineError>{t("Could not load the full output.")}</InlineError>
            ) : null}
          </div>
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
  // A different run invalidates any copy in flight and any shown outcome; streaming
  // content of the same run does not, because the text is read when the click happens.
  const feedback = useCopyFeedback({ resetKeys: [block.id], successMs: 2000 });
  const command = !isSubagentBlock(block);
  const copy = () => {
    const text = command
      ? commandDetailsCopyText(block, busy, status, t)
      : agentRunMarkdown(block, status);
    if (!text) return;
    feedback.copy(() => copyText(text));
  };
  const label = feedback.copied
    ? t("Copied")
    : feedback.failed
      ? t("Copy failed. Try again.")
      : command
        ? t("Copy details")
        : t("Copy transcript");
  return (
    <Button
      className="shrink-0"
      variant="ghost"
      type="button"
      loading={feedback.pending}
      onClick={copy}
      tooltip={command ? label : t("{p0} (Markdown)", { p0: label })}
      aria-label={label}
    >
      {feedback.copied ? (
        <Check className="icon-md" strokeWidth={1.75} />
      ) : (
        <Copy className="icon-md" strokeWidth={1.75} />
      )}
    </Button>
  );
}

/** What the subagent was asked, clamped until the reader opens it. */
function PromptCard({ prompt }: { prompt: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = prompt.length > 360 || prompt.split("\n").length > 6;
  return (
    <section
      aria-label={t("Prompt")}
      className="mb-2 rounded-lg bg-(--ui-surface-panel) px-3 py-2 text-ui-secondary leading-5"
    >
      <h3 className="pb-0.5 text-ui-caption font-medium text-(--ui-text-secondary)">
        {t("Prompt")}
      </h3>
      <p
        className={`min-w-0 whitespace-pre-wrap break-words text-(--ui-text-secondary) ${
          open || !long ? "" : "line-clamp-6"
        }`}
      >
        {prompt}
      </p>
      {long ? (
        <Button
          variant="ghost"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("Show less") : t("Show full prompt")}
        </Button>
      ) : null}
    </section>
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
  if (step.kind === "message") {
    return (
      <div className="min-w-0 py-1">
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
  const trail = report ? steps.filter((step) => !isReportStep(step, report)) : steps;
  const visible = trail.length > shown ? trail.slice(trail.length - shown) : trail;
  const hidden = trail.length - visible.length;

  const following = useFollowBottom(scroller, true, steps, 32, false, report);

  return (
    <div
      ref={scroller}
      data-subagent-trail
      className="min-h-0 flex-1 overflow-y-auto overscroll-none [scrollbar-gutter:stable]"
    >
      <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
        {prompt ? <PromptCard prompt={prompt} /> : null}
        {visible.length === 0 && !report ? (
          <p className="pt-1 text-ui-caption text-(--ui-text-secondary)">
            {running ? t("Waiting for the first step.") : t("This agent did not report any steps.")}
          </p>
        ) : null}
        {hidden > 0 ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              following.current = false;
              setShown((count) => count + STEP_PAGE);
            }}
            className="self-start"
          >
            {t("Show earlier steps (")}
            {hidden})
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
      </div>
    </div>
  );
}
