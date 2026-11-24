import { Text } from "../../../shared/ui/Text";
import { createContext, useContext, useEffect, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useLocale, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Check, ExternalLink, Square } from "../../../shared/ui/icons";
import { blockLifecycle } from "../model/activityDock";
import { crewMemberOf, delegationParentOf } from "../model/delegatedAgents";
import { modelNameBesideIcon } from "../model/modelDisplayName";
import { delegationResultFor } from "../model/delegationNotice";
import { delegatedChildIdOf } from "../model/delegatedBlockId";
import { sessionNeedsInput, type Block } from "../model/session";
import { subagentStepStrip } from "../model/subagentStepStrip";
import { useSession, useSessionsSelector } from "../model/sessionsStore";
import { useSubagentModelName } from "../model/reactiveReads";
import {
  needsApproval,
  subagentName,
  subagentReport,
  toolCallState,
} from "../model/transcriptActivity";
import { requestViewDelegated, retryDelegated, stopDelegated } from "./delegatedFocus";
import { useStopRequests } from "./useStopRequests";
import { ActivityPhases } from "./AgentTranscriptActivity";
import { blockForStep } from "./agentStepBlocks";
import { SubagentRetryButton } from "./SubagentRetryButton";
import { SubagentRowContent } from "./SubagentRowContent";
import { subagentRunDescription, SubagentRunStatus } from "./SubagentRunStatus";
import { runLabelWith, SubagentReport } from "./SubagentAnatomy";
import { consumeOpenSubagent, OPEN_SUBAGENT_EVENT, requestViewSubagent } from "./subagentFocus";
import { TranscriptVirtualRows } from "./TranscriptVirtualRows";
import { useTranscriptRevealTarget } from "./transcriptVirtualization";
import { useRetainedDisclosure } from "./useRetainedDisclosure";
import { useSubagentRunIdentity, type SubagentRunSession } from "./useSubagentRunIdentity";
import { subagentGroupLayout, subagentGroupProgress } from "./subagentGroupLayout";
import { SubagentCardFace } from "./SubagentCardFace";
import styles from "./SubagentRow.module.css";

/** The conversation whose transcript renders these rows; Crew member cards open and stop through it. */
export const DelegatedRunOwner = createContext<string | undefined>(undefined);

type SubagentVariant = "row" | "list" | "card";

type DelegatedCard = {
  /** The child session, for its provider, account and effort. */
  session?: SubagentRunSession;
  /** The task, leading the row's detail line. */
  subtitle?: string;
  /** A Crew member's handle, beside the name. */
  handle?: string;
  needsInput?: boolean;
  onOpen: () => void;
  /** Present while the member is still running. */
  onStop?: () => void;
  stopping?: boolean;
  stopFailed?: boolean;
  /** A failed child can be sent the same task again. */
  onRetry?: () => Promise<void>;
  /** The main agent already received this child's result. */
  resultReceived?: boolean;
};

/**
 * Every delegated run in the turn. Up to three show as cards in one row; more show as one
 * aligned row each, under a counter of how many finished. The main transcript cycles — work
 * folds behind a line, messages stay visible — and a subagent you are watching must not move
 * while that happens, so these are never part of a fold and hold their place from the moment
 * the agents start.
 *
 * A row is the provider, the run's name and detail, and what it is doing right now. Click it
 * and the agent's own trail opens underneath; a card's trail opens in one full-width area under
 * the cards, one at a time, so the cards keep equal heights. A lone run is just its row.
 */
export function SubagentStack({
  blocks,
  cwd,
  live = false,
  embedded = false,
  onOpenFile,
  onOpenDiff,
}: {
  blocks: Block[];
  cwd?: string;
  live?: boolean;
  embedded?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  useLocale();
  const wrapper = `flex min-w-0 flex-col ${embedded ? "" : "px-4"}`;
  const layout = subagentGroupLayout(blocks.length);
  // shortcut: the open card is plain state, not retained across a released transcript; cards are never virtualized, upgrade if remounting loses the reader's pick.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  if (layout === "cards") {
    // A run that died is open on its reason until the reader picks another; one trail at a time.
    const openId =
      picked === undefined
        ? (blocks.find((block) => toolCallState(block) === "rejected")?.id ?? null)
        : picked;
    return (
      <div className={wrapper}>
        <div className={styles.cards} data-subagent-cards={blocks.length}>
          {blocks.map((block) => (
            <SubagentRow
              key={block.id}
              block={block}
              cwd={cwd}
              live={live}
              variant="card"
              controlled={{
                open: openId === block.id,
                onOpenChange: (next) => setPicked(next ? block.id : null),
              }}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
          ))}
        </div>
      </div>
    );
  }
  const progress = subagentGroupProgress(blocks.map((block) => blockLifecycle(block, live)));
  return (
    <div className={wrapper}>
      <div
        className={layout === "list" ? styles.list : "flex min-w-0 flex-col"}
        data-subagent-list={layout === "list" ? blocks.length : undefined}
      >
        {layout === "list" ? (
          <Text size="caption" tone="muted" className={`${styles.listHeader} tabular-nums`}>
            {t("{p0}/{p1} done", { p0: progress.done, p1: progress.total })}
            {progress.failed ? ` · ${t("{p0} failed", { p0: progress.failed })}` : ""}
          </Text>
        ) : null}
        <TranscriptVirtualRows
          listId={`agents:${blocks[0]?.id}`}
          rows={blocks.map((block) => ({
            id: block.id,
            blockIds: [block.id],
            pinned:
              needsApproval(block) ||
              !!block.streaming ||
              ((live || !!delegatedChildIdOf(block.id)) && toolCallState(block) === "pending"),
            render: () => (
              <SubagentRow
                block={block}
                cwd={cwd}
                live={live}
                variant={layout}
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
              />
            ),
          }))}
        />
      </div>
    </div>
  );
}

/**
 * One delegated run's row, stateful about being opened. A run that died opens
 * itself, so the provider's reason is not buried behind a face that looks like
 * every other finished one. A click takes the row over from there and it stays
 * where the reader puts it. The same row serves inside a settled turn's trail,
 * where the run sits as one step of the work it was spawned from.
 */
export function SubagentRow({
  block,
  cwd,
  live = false,
  variant = "row",
  controlled,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  /** `card` and `list` come from the group's size; `row` is a lone run. */
  variant?: SubagentVariant;
  /** The group owns which card is open, so only one trail shows under the cards. */
  controlled?: { open: boolean; onOpenChange: (open: boolean) => void };
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  // A Crew member's ask is a child session: it runs whether or not this turn does, opens in
  // the session's own sheet, and stops through the pane that owns it.
  const parentId = useContext(DelegatedRunOwner);
  const childId = delegatedChildIdOf(block.id);
  const child = useSession(childId);
  const stops = useStopRequests();
  const running = toolCallState(block) === "pending";
  const runId = child && delegationParentOf(child)?.runId;
  const resultReceived = useSessionsSelector((sessions) => {
    const parent = sessions.find((session) => session.id === parentId);
    return !!parent && !!runId && !!delegationResultFor(parent.blocks, runId);
  });
  const delegated: DelegatedCard | undefined =
    childId && parentId
      ? {
          session: child,
          handle: child && crewMemberOf(child)?.handle,
          subtitle: child?.title,
          needsInput: !!child && sessionNeedsInput(child),
          onOpen: () => requestViewDelegated(parentId, childId),
          resultReceived,
          ...(toolCallState(block) === "rejected"
            ? { onRetry: () => retryDelegated(parentId, childId) }
            : {}),
          ...(running
            ? {
                onStop: () => stops.request(childId, () => stopDelegated(parentId, childId)),
                stopping: stops.stopping.has(childId),
                stopFailed: stops.failed.has(childId),
              }
            : {}),
        }
      : undefined;
  const [override, setOverride] = useRetainedDisclosure<boolean | null>(`agent:${block.id}`, null);
  const reveal = useTranscriptRevealTarget();
  const open =
    reveal === block.id ||
    (controlled ? controlled.open : (override ?? toolCallState(block) === "rejected"));
  const setOpen = useStableCallback((next: boolean) =>
    controlled ? controlled.onOpenChange(next) : setOverride(next),
  );
  // The composer's activity dock opens a run from outside the transcript. The
  // row may only mount after the transcript reveals it, so check on mount too.
  useEffect(() => {
    const openIfAsked = () => {
      if (consumeOpenSubagent(block.id)) setOpen(true);
    };
    openIfAsked();
    window.addEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
    return () => window.removeEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
  }, [block.id, setOpen]);
  return (
    <SubagentPanel
      block={block}
      cwd={cwd}
      live={live || (!!delegated && running)}
      delegated={delegated}
      variant={variant}
      open={open}
      onToggle={() => setOpen(!open)}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}

/**
 * One delegated run: its name, what it is doing, and — once opened — the trail
 * it left, with the same tool rows, thinking and prose the main transcript
 * shows. While it runs the trail is a short window pinned to the newest step,
 * so a subagent doing hundreds of things cannot push the turn off the screen.
 */
function SubagentPanel({
  block,
  cwd,
  live = false,
  delegated,
  variant,
  open,
  onToggle,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  variant: SubagentVariant;
  /** Set for a Crew member's child session; the card then opens and stops that session. */
  delegated?: DelegatedCard;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const name = subagentName(block);
  const model = useSubagentModelName(block);
  // A child named for its task would repeat that task beside its own name.
  const subtitle =
    delegated?.subtitle && delegated.subtitle !== name ? delegated.subtitle : undefined;
  const state = toolCallState(block);
  const active = live && state === "pending";
  const runSteps = block.agentRun?.steps;
  const steps = runSteps ?? [];
  // The run's trail as transcript blocks, so the panel groups it the way the
  // main transcript groups the agent's own work: what it said, then the calls
  // that line introduced, folding behind it once it moves on.
  const stepBlocks = steps.map(blockForStep);
  const report = subagentReport(block);
  const openPanel = delegated?.onOpen ?? (() => requestViewSubagent(block.id));

  const needsInput = !!delegated?.needsInput || needsApproval(block);
  const strip = subagentStepStrip(steps, active && !needsInput);
  const description = subagentRunDescription(
    needsInput && active ? t("Needs input") : runLabelWith(block, live, t),
    strip,
    state === "rejected",
    t,
  );
  const { account, effort } = useSubagentRunIdentity(delegated?.session, block.agentRun?.model);
  const round = block.agentRun?.round;
  const session = delegated?.session;
  const rowContent = () => (
    <SubagentRowContent
      harness={session?.runningModelTarget?.harness ?? session?.harness}
      model={block.agentRun?.model}
      account={account}
      name={name}
      active={active}
      failed={state === "rejected"}
      handle={delegated?.handle}
      subtitle={subtitle}
      details={[
        round && round > 1 ? t("Round {p0}", { p0: round }) : undefined,
        model && modelNameBesideIcon(model),
        account?.accountLabel,
        effort,
      ]}
      status={
        <SubagentRunStatus
          status={blockLifecycle(block, live)}
          needsInput={needsInput}
          startedAt={block.agentRun?.startedAt}
          endedAt={block.agentRun?.endedAt}
          strip={strip}
          layout={variant === "list" ? "list" : "row"}
        />
      }
      layout={variant === "list" ? "list" : "dock"}
    />
  );

  const stopFailure = delegated?.stopFailed ? (
    <Text as="span" size="caption" tone="danger" className="self-end">
      {t("Stop failed. Retry")}
    </Text>
  ) : null;

  const stopButton = delegated?.onStop ? (
    <Button
      motion="none"
      iconOnly
      variant="ghost"
      type="button"
      label={
        delegated.stopping
          ? t("Stopping {p0}…", { p0: name })
          : delegated.stopFailed
            ? t("Could not stop. Retry")
            : t("Stop {p0}", { p0: name })
      }
      disabled={delegated.stopping}
      onClick={delegated.onStop}
      className="shrink-0"
    >
      <Square className="icon-xs" strokeWidth={1.75} aria-hidden />
    </Button>
  ) : null;
  const panelButton = (
    <Button
      motion="none"
      iconOnly
      label={t("Open {p0} in its own panel", { p0: name })}
      variant="ghost"
      type="button"
      tooltip={t("Open in panel")}
      onClick={openPanel}
      className="shrink-0"
    >
      <ExternalLink className="icon-sm" aria-hidden />
    </Button>
  );
  const actions = (
    <>
      {panelButton}
      {stopButton}
    </>
  );

  const trail = (
    <div className="zen-phase-body" data-open={open}>
      {open ? (
        /*
         * No scroll window of its own. Each phase inside already keeps the
         * group the run is working in to a short pinned window; wrapping a
         * second window around them nests one 17.5rem scroller inside
         * another, and the inner one can never reach its own last row.
         */
        <div className="flex min-w-0 flex-col pb-1">
          <ActivityPhases
            blocks={stepBlocks}
            cwd={cwd}
            done={!active}
            padded={false}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
          <SubagentReport
            block={block}
            cwd={cwd}
            onOpenFile={onOpenFile}
            heading="h4"
            className="mt-2 ps-5"
          />
          {(variant !== "card" && delegated?.onRetry) || delegated?.resultReceived ? (
            <div className="mt-2 flex min-w-0 flex-col items-start gap-1.5 ps-5">
              {variant !== "card" && delegated.onRetry ? (
                <SubagentRetryButton onRetry={delegated.onRetry} />
              ) : null}
              {delegated.resultReceived ? (
                <Text
                  size="caption"
                  tone="muted"
                  className="flex items-center gap-1"
                  data-delegation-result-received
                >
                  <Check className="icon-xs" aria-hidden />
                  {t("Result received by the main agent")}
                </Text>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (variant === "card") {
    const hasTrail = steps.length > 0 || !!report;
    return (
      <>
        <SubagentCardFace
          name={name}
          active={active}
          failed={state === "rejected"}
          lifecycle={blockLifecycle(block, live)}
          harness={session?.runningModelTarget?.harness ?? session?.harness}
          model={block.agentRun?.model}
          account={account}
          details={[
            round && round > 1 ? t("Round {p0}", { p0: round }) : undefined,
            model && modelNameBesideIcon(model),
            account?.accountLabel,
            effort,
          ]}
          status={
            <SubagentRunStatus
              status={blockLifecycle(block, live)}
              needsInput={needsInput}
              startedAt={block.agentRun?.startedAt}
              endedAt={block.agentRun?.endedAt}
              strip={strip}
              layout="card"
            />
          }
          description={description}
          toggleLabel={
            hasTrail
              ? open
                ? t("Hide {p0}'s work", { p0: name })
                : t("Show {p0}'s work", { p0: name })
              : undefined
          }
          open={open}
          onToggle={onToggle}
          reason={state === "rejected" ? report : undefined}
          footer={
            <>
              {delegated?.onRetry ? <SubagentRetryButton onRetry={delegated.onRetry} /> : null}
              {stopFailure}
              <span className="ms-auto flex items-center">{actions}</span>
            </>
          }
        />
        {open && hasTrail ? (
          <div className={styles.cardTrail} data-subagent-trail>
            {trail}
          </div>
        ) : null}
      </>
    );
  }

  // A run can report its first step late (or never). Nothing opens under the row, so it has no
  // chevron and the row itself does nothing; its prompt and status stay in the panel button.
  if (steps.length === 0 && !report) {
    return (
      <div className="flex min-w-0 flex-col">
        <Disclosure
          variant="step"
          collapsible={false}
          summaryLabel={name}
          aria-description={description}
          summary={rowContent()}
          summaryActions={actions}
        />
        {stopFailure}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Disclosure
        variant="step"
        chevron="end"
        open={open}
        onOpenChange={onToggle}
        aria-description={description}
        summaryLabel={
          open ? t("Hide {p0}'s work", { p0: name }) : t("Show {p0}'s work", { p0: name })
        }
        summary={rowContent()}
        summaryActions={actions}
      >
        {trail}
      </Disclosure>
      {stopFailure}
    </div>
  );
}
