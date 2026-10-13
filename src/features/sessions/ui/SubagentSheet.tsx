import { useFollowBottom } from "../hooks/useFollowBottom";
import { t, useLocale } from "../../../shared/i18n";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { GlassBackdrop } from "../../../app/shell/GlassBackdrop";
import { Check, Copy, CornerDownRight, Square, X } from "../../../shared/ui/icons";
import { copyText } from "../../../platform/tauri/clipboard";
import { agentRunMarkdown, isReportStep } from "../model/agentRunMarkdown";
import type { AgentStep, Block } from "../model/session";
import {
  isStoppedBlock,
  isSubagentBlock,
  subagentModelName,
  subagentName,
  subagentReport,
  subagentStatusLine,
  toolCallState,
  toolCallLabel,
} from "../model/transcriptActivity";
import { AgentClock } from "./AgentClock";
import { ActivityRow, agentStepBlock } from "./AgentTranscript";
import { AgentMarkdown } from "./AgentMarkdown";
import { VIEW_SUBAGENT_EVENT } from "./subagentFocus";
import { useStopRequests } from "./useStopRequests";

/**
 * Which delegated run's panel is open in a session pane. The pane that owns the
 * block answers `requestViewSubagent`; panes that do not have it ignore it, so
 * one request opens one panel and asking for another agent swaps the content.
 */
export function useSubagentSheet(blocks: Block[], visible: boolean) {
  const [openId, setOpenId] = useState<string | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
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
  const gone = openId !== null && !block;
  useEffect(() => {
    if (gone) close();
  }, [gone, close]);

  return { block, open, close };
}

const stepBlocks = new WeakMap<AgentStep, Block>();

/** Stable block per step, so an unchanged step does not re-render as it arrives. */
function blockForStep(step: AgentStep): Block {
  let block = stepBlocks.get(step);
  if (!block) {
    block = agentStepBlock(step);
    stepBlocks.set(step, block);
  }
  return block;
}

function runLabel(block: Block, busy: boolean): string {
  if (isStoppedBlock(block)) return t("Stopped by you");
  const state = toolCallState(block);
  if (state === "rejected") return t("Failed");
  if (state === "pending") return busy ? t("Running") : t("Stopped");
  return t("Done");
}

/** Steps shown at first, and added by each "Show earlier steps". */
const STEP_PAGE = 60;

/**
 * One subagent's run in a sheet over the session pane, read as a conversation:
 * the prompt it was given, what it said, each call with what it returned, and
 * its report. It reads the same block the transcript row does, so it fills in
 * live, and renders calls and thoughts through the transcript's own rows. There
 * is no composer: subagents cannot be messaged.
 */
export function SubagentSheet({
  block,
  busy,
  visible,
  cwd,
  onClose,
  onStop,
  onShowInTranscript,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  busy: boolean;
  visible: boolean;
  cwd?: string;
  onClose: () => void;
  /** Present when the harness can stop this one run without the whole turn. */
  onStop?: () => Promise<void>;
  onShowInTranscript: (blockId: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  const sheetRef = useRef<HTMLElement>(null);
  const command = !isSubagentBlock(block);
  const name = command ? t("Command details") : subagentName(block);
  const model = command ? undefined : subagentModelName(block);
  const run = block.agentRun;
  const state = toolCallState(block);
  const running = busy && state === "pending";
  const steps = run?.steps ?? [];
  const summary = isStoppedBlock(block) ? "" : subagentStatusLine(block, steps);
  const stops = useStopRequests();
  const stopKey = block.tool?.callId ?? block.id;
  const stopping = stops.stopping.has(stopKey);

  // Esc closes from anywhere in this pane, as the side-question sheet does.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!visible || !sheet) return;
    const pane = sheet.closest("[data-session-drop]") ?? sheet.parentElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target !== document.body && !(target && pane?.contains(target))) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  // Focus moves into the panel when it opens; swapping agents leaves it where
  // the reader put it.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet && !sheet.contains(document.activeElement)) sheet.focus();
  }, []);

  return (
    <div data-subagent-overlay className="subagent-overlay absolute inset-0 z-40">
      <div aria-hidden className="absolute inset-0" onMouseDown={onClose} />
      <section
        ref={sheetRef}
        role="dialog"
        aria-label={command ? name : t("Subagent: {p0}", { p0: name })}
        tabIndex={-1}
        className="subagent-sheet absolute inset-y-0 right-0 isolate w-[min(34rem,94%)] outline-none"
      >
        <GlassBackdrop className="subagent-sheet-glass popover-backdrop" />
        <div className="relative z-[1] flex h-full min-h-0 flex-col font-sans text-sm text-content">
          <header className="flex shrink-0 flex-col gap-1 border-b border-content/8 py-2.5 pr-2 pl-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
                {name}
              </h2>
              <CopyTranscriptButton block={block} status={runLabel(block, busy)} />
              {onStop && running ? (
                <button
                  type="button"
                  disabled={stopping}
                  title={
                    stops.failed.has(stopKey)
                      ? t("Could not stop it. Try again.")
                      : t(command ? "Stop this command" : "Stop this subagent")
                  }
                  onClick={() => stops.request(stopKey, onStop)}
                  className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-content/8 hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:pointer-events-none ${
                    stops.failed.has(stopKey) ? "text-red-400" : "text-content/55"
                  }`}
                >
                  <Square className="size-3.5" strokeWidth={1.75} />
                  {stopping ? t("Stopping…") : t("Stop")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onShowInTranscript(block.id)}
                title={
                  command ? t("Show in transcript") : t("Scroll to this agent in the transcript")
                }
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-content/55 transition-colors hover:bg-content/8 hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <CornerDownRight className="size-3.5" strokeWidth={1.75} />
                {t("Show in transcript")}
              </button>
              <button
                type="button"
                aria-label={t(command ? "Close command panel" : "Close agent panel")}
                title={t("Close (Esc)")}
                onClick={onClose}
                className="grid size-7 shrink-0 place-items-center rounded-md text-content/45 transition-colors hover:bg-content/8 hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-content/45">
              <span
                className={state === "rejected" ? "text-red-400" : running ? "text-accent" : ""}
              >
                {runLabel(block, busy)}
              </span>
              {run?.agentType ? <span>{run.agentType}</span> : null}
              {model ? <span title={t("Model: {p0}", { p0: model })}>{model}</span> : null}
              {summary && state !== "rejected" ? <span>{summary}</span> : null}
              <AgentClock startedAt={run?.startedAt} endedAt={run?.endedAt} live={running} />
            </div>
          </header>
          {command ? (
            <CommandDetails key={block.id} block={block} cwd={cwd} />
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
          {!command ? (
            <p className="shrink-0 border-t border-content/8 px-4 py-2 text-xs text-content/40">
              {t("Read-only. Subagents cannot be messaged.")}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/** Provider-reported command data; updates from the same live block as the dock. */
function CommandDetails({ block, cwd }: { block: Block; cwd?: string }) {
  useLocale();
  const command =
    block.tool?.preview?.title || block.tool?.title || block.text || toolCallLabel(block);
  const output = block.tool?.preview?.output || block.tool?.output;
  const detail = block.tool?.detail?.trim();
  const result = [output, detail && detail !== command && detail !== output ? detail : undefined]
    .filter(Boolean)
    .join("\n\n");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 py-3">
      <h3 className="mb-1 text-xs text-content/45">{t("Command")}</h3>
      <pre className="select-text whitespace-pre-wrap break-words rounded-lg bg-content/6 p-3 font-mono text-xs leading-5">
        {command}
      </pre>
      {cwd ? (
        <>
          <h3 className="mt-4 mb-1 text-xs text-content/45">{t("Working directory")}</h3>
          <pre className="select-text whitespace-pre-wrap break-words font-mono text-xs">{cwd}</pre>
        </>
      ) : null}
      <h3 className="mt-4 mb-1 text-xs text-content/45">{t("Output")}</h3>
      {result ? (
        <pre className="select-text whitespace-pre-wrap break-words rounded-lg bg-content/6 p-3 font-mono text-xs leading-5">
          {result}
        </pre>
      ) : (
        <p className="text-xs text-content/45">
          {t("No output has been reported for this command yet.")}
        </p>
      )}
      {block.tool?.outputTruncated ? (
        <p className="mt-2 text-xs text-content/45">{t("Output was truncated by the provider.")}</p>
      ) : null}
    </div>
  );
}

/** Copies the run as Markdown; the icon confirms it for a moment. */
function CopyTranscriptButton({ block, status }: { block: Block; status: string }) {
  useLocale();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    const text = isSubagentBlock(block)
      ? agentRunMarkdown(block, status)
      : [
          block.tool?.preview?.title || block.tool?.title || block.text,
          status,
          block.tool?.preview?.output || block.tool?.output,
          block.tool?.detail,
        ]
          .filter(Boolean)
          .join("\n\n");
    if (!text) return;
    void copyText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };
  const label =
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy transcript";
  return (
    <button
      type="button"
      onClick={copy}
      title={t("{p0} (Markdown)", { p0: label })}
      aria-label={label}
      className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-content/8 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
        state === "failed" ? "text-red-400" : "text-content/45 hover:text-content"
      }`}
    >
      {state === "copied" ? (
        <Check className="size-4" strokeWidth={1.75} />
      ) : (
        <Copy className="size-4" strokeWidth={1.75} />
      )}
    </button>
  );
}

/** What the subagent was asked, clamped until the reader opens it. */
function PromptCard({ prompt }: { prompt: string }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const long = prompt.length > 360 || prompt.split("\n").length > 6;
  return (
    <section
      aria-label={t("Prompt")}
      className="rounded-lg bg-content/6 px-3 py-2 text-[13px] leading-5"
    >
      <h3 className="pb-0.5 text-[11px] font-medium tracking-wide text-content/40 uppercase">
        {t("Prompt")}
      </h3>
      <p
        className={`min-w-0 whitespace-pre-wrap break-words text-content/80 ${
          open || !long ? "" : "line-clamp-6"
        }`}
      >
        {prompt}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="pt-1 text-xs text-content/50 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
        >
          {open ? t("Show less") : t("Show full prompt")}
        </button>
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
  useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  // Follow the newest step until the reader scrolls up; scrolling back to the
  // end picks the follow up again.
  const report = subagentReport(block);
  const failed = toolCallState(block) === "rejected";
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
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
      <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
        {prompt ? <PromptCard prompt={prompt} /> : null}
        {visible.length === 0 && !report ? (
          <p className="pt-1 text-xs text-content/45">
            {running ? t("Waiting for the first step.") : t("This agent did not report any steps.")}
          </p>
        ) : null}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => {
              following.current = false;
              setShown((count) => count + STEP_PAGE);
            }}
            className="self-start rounded-md bg-content/8 px-2.5 py-1 text-xs text-content/60 hover:bg-content/12 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t("Show earlier steps (")}
            {hidden})
          </button>
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
        {report ? (
          <section
            aria-label={failed ? t("Failure") : t("Report")}
            className="mt-1 border-t border-content/8 pt-2"
          >
            {failed ? (
              <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-red-400/80">
                {report}
              </pre>
            ) : (
              <AgentMarkdown text={report} cwd={cwd} onOpenFile={onOpenFile} />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
