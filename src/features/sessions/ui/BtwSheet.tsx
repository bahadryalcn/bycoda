import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { BtwStatusDot } from "./BtwStatusDot";
import { Alert } from "../../../shared/ui/Alert";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Sheet } from "../../../shared/ui/Sheet";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { useT } from "../../../shared/i18n";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, RefreshCw, X } from "../../../shared/ui/icons";

import { Composer } from "./Composer";
import {
  retainParentInput,
  useParentInputClosure,
  useParentInputsClosed,
  canPublishParentInput,
  mutateParentInput,
  type ParentAdmission,
} from "../data/parentInputClosure";
import { AgentTranscript } from "./AgentTranscript";
import { preferredModelSettings, resolveModel } from "../model/models";
import {
  btwOpenTargetTurnId,
  btwThreadBlocks,
  btwSurfaceHarness,
  sessionBtwThreads,
} from "../model/btw";
import { groupTurns } from "../model/transcriptActivity";
import {
  DEFAULT_RUNTIME_MODE,
  HARNESS_TITLE,
  type Block,
  type BtwMessage,
  type BtwThread,
  type HarnessId,
} from "../model/session";
import { compactQuestion } from "../model/btwQuestion";

type Options = {
  parentSessionId?: string;
  /** False when this session cannot take side questions right now. */
  available: boolean;
  blocks: Block[];
  /** The session's current harness; each tab resolves its own from its turn. */
  harness: HarnessId;
  managed?: boolean;
  model?: string;
  modelSettings?: Record<string, string>;
  onSubmit: (
    turn: Block[],
    threadId: string,
    messageId: string,
    text: string,
    model?: string,
    modelSettings?: Record<string, string>,
  ) => boolean | void;
  onRetry: (turn: Block[], threadId: string) => void;
  onDelete?: (turn: Block[], threadId: string) => void;
  onStop?: (turn: Block[], threadId: string) => void;
  onModelChange?: (
    turn: Block[],
    threadId: string,
    model: string,
    modelSettings: Record<string, string>,
  ) => void;
};

export type BtwTab = {
  id: string;
  turn: Block[];
  thread?: BtwThread;
  question?: string;
  status?: BtwThread["status"];
};

export type BtwConversation = ReturnType<typeof useBtwConversation>;

function tabHarnessFor(
  blocks: Block[],
  tab: BtwTab,
  sessionHarness: HarnessId,
): HarnessId | undefined {
  const user = tab.turn.find((block) => block.role === "user");
  return (
    tab.thread?.harness ?? btwSurfaceHarness(blocks, tab.turn, sessionHarness, user?.btwThreads)
  );
}

const NO_MESSAGES: BtwMessage[] = [];
const NO_BLOCKS: Block[] = [];

/**
 * State for `/btw` side conversations. The session's own composer asks the
 * questions while this is open; the sheet shows one tab per side thread.
 */
export function useBtwConversation({
  parentSessionId,
  available,
  blocks,
  harness,
  managed = false,
  model = "",
  modelSettings = {},
  onSubmit,
  onRetry,
  onDelete,
  onStop,
  onModelChange,
}: Options) {
  const inputClosed = useParentInputsClosed(parentSessionId);
  const [requestedOpen, setRequestedOpen] = useState(false);
  const open = requestedOpen && available;
  // Availability can vanish without an explicit close; drop the request so it cannot reopen later.
  if (!available && requestedOpen) setRequestedOpen(false);
  // Stay mounted while the close animation plays.
  const [rendered, setRendered] = useState(false);
  if (open && !rendered) setRendered(true);
  const [drafts, setDrafts] = useState<{ id: string; turnId: string }[]>([]);
  const draftTextsRef = useRef<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftModelSettings, setDraftModelSettings] = useState<Record<string, string> | null>(null);
  const [optimistic, setOptimistic] = useState<{
    threadId: string;
    message: BtwMessage;
  } | null>(null);
  // Unsent text the side composer starts from; a new key remounts it.
  const [seed, setSeed] = useState({ key: 0, text: "" });
  const parentChanged = useParentInputClosure({
    kind: "btw-parent",
    sessionId: parentSessionId,
    snapshot: () => ({
      requestedOpen,
      rendered,
      available,
      drafts,
      draftTexts: draftTextsRef.current,
      activeId,
      draftModel,
      draftModelSettings,
      optimistic,
      seed,
      harness,
      model,
      modelSettings,
    }),
    missingCoverage: ["nested-btw-input-scope", "decision-conservation"],
  });

  const turns = groupTurns(blocks, managed);
  const entries = sessionBtwThreads(blocks, managed);
  // Drafts and the optimistic message are placeholders until the persisted thread shows up.
  const persistedThreadIds = new Set(entries.map(({ thread }) => thread.id));
  const pendingDrafts = drafts.filter((draft) => !persistedThreadIds.has(draft.id));
  const pendingOptimistic =
    optimistic &&
    !entries.some(
      ({ thread }) =>
        thread.id === optimistic.threadId &&
        thread.messages.some((message) => message.id === optimistic.message.id),
    )
      ? optimistic
      : null;
  const baseTabs: BtwTab[] = entries.map(({ thread, turn }) => ({
    id: thread.id,
    turn,
    thread,
  }));
  for (const draft of pendingDrafts) {
    if (baseTabs.some((tab) => tab.id === draft.id)) continue;
    const turn = turns.find((entry) => entry[0]?.id === draft.turnId);
    if (turn) baseTabs.push({ id: draft.id, turn });
  }
  const tabs = baseTabs.map((tab) => {
    const pending = pendingOptimistic?.threadId === tab.id ? pendingOptimistic : null;
    return {
      ...tab,
      question:
        tab.thread?.messages.find((message) => message.role === "user")?.text ??
        pending?.message.text,
      status: tab.thread?.status ?? (pending ? "running" : undefined),
    };
  });
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1];
  const activeTabId = active?.id ?? null;
  const persisted = active?.thread;
  const tabHarness = active ? tabHarnessFor(blocks, active, harness) : undefined;
  const composerHarness = tabHarness ?? harness;
  const baseModelFor = (tab: BtwTab) =>
    tab.turn.find((block) => block.role === "user")?.turnModel?.id ?? model;

  const optimisticForTab =
    pendingOptimistic?.threadId === activeTabId ? pendingOptimistic.message : undefined;
  const persistedMessages = persisted?.messages ?? NO_MESSAGES;
  // Stable while nothing changes, so the transcript is not re-fed each render.
  const messages =
    optimisticForTab && !persistedMessages.some((message) => message.id === optimisticForTab.id)
      ? [...persistedMessages, optimisticForTab]
      : persistedMessages;
  const running = persisted?.status === "running" || !!optimisticForTab;
  const selectedModel = draftModel ?? persisted?.model ?? (active ? baseModelFor(active) : model);
  const selectedModelSettings = useMemo(() => {
    if (draftModelSettings) return draftModelSettings;
    if (persisted?.modelSettings) return persisted.modelSettings;
    return preferredModelSettings(resolveModel(composerHarness, selectedModel), modelSettings);
  }, [composerHarness, draftModelSettings, modelSettings, persisted?.modelSettings, selectedModel]);

  const finishClose = () => {
    parentChanged();
    // Availability can disappear without an explicit close (for example when
    // the session changes harness). Do not leave a latent open request that
    // reopens the sheet if availability later returns.
    setRequestedOpen(false);
    setRendered(false);
    setDrafts([]);
    draftTextsRef.current = {};
    setOptimistic(null);
    setDraftModel(null);
    setDraftModelSettings(null);
  };

  // Stable so the read of `Date.now()` inside stays an event-time read, not a render-time one.
  const send = useStableCallback(
    (
      tab: BtwTab,
      text: string,
      nextModel: string,
      nextSettings: Record<string, string>,
      rawText = text,
      original?: ParentAdmission,
    ): boolean => {
      const operation = () => {
        const messageId = crypto.randomUUID();
        const input = {
          source: "btw-dispatch-intent",
          disposition: "dispatching",
          threadId: tab.id,
          turnIds: tab.turn.map((block) => block.id),
          messageId,
          text,
          rawText,
          model: nextModel,
          modelSettings: nextSettings,
        };
        const retained = retainParentInput({
          kind: "btw-parent",
          sessionId: parentSessionId,
          snapshot: () => input,
          missingCoverage: ["decision-conservation", "nested-btw-input-scope"],
        });
        const accepted = onSubmit(
          tab.turn,
          tab.id,
          messageId,
          text,
          nextModel || undefined,
          nextSettings,
        );
        if (accepted === false) {
          retained.release();
          return false;
        }
        retained.update({ ...input, disposition: "accepted-unknown" });
        setOptimistic({
          threadId: tab.id,
          message: { id: messageId, role: "user", text, createdAt: Date.now() },
        });
        return true;
      };
      return original
        ? parentChanged.continue(original, operation)
        : mutateParentInput(parentChanged, operation);
    },
  );

  // A new tab reads from the latest finished turn at the moment it opens.
  const startDraft = (): BtwTab | null => {
    if (!parentChanged.canMutate()) return null;
    const turnId = btwOpenTargetTurnId(turns, blocks, harness, managed);
    const turn = turnId ? turns.find((entry) => entry[0]?.id === turnId) : undefined;
    if (!turnId || !turn) return null;
    const id = crypto.randomUUID();
    setDrafts((current) => [...current, { id, turnId }]);
    setActiveId(id);
    setDraftModel(null);
    setDraftModelSettings(null);
    draftTextsRef.current[id] = "";
    setSeed((current) => ({ key: current.key + 1, text: "" }));
    return { id, turn };
  };

  const selectTab = (id: string) => {
    if (!parentChanged.canMutate()) return;
    if (id === activeTabId) return;
    setDraftModel(null);
    setDraftModelSettings(null);
    setActiveId(id);
    setSeed((current) => ({
      key: current.key + 1,
      text: draftTextsRef.current[id] ?? "",
    }));
  };

  /**
   * Open a new tab. `text` is sent right away, or left unsent in the side
   * composer with `draft`. Stable so its `preferredModelSettings` read stays an event-time read.
   */
  const openWith = useStableCallback(
    (text: string, options?: { draft?: boolean }, original?: ParentAdmission): boolean => {
      const operation = () => {
        if (!parentChanged.canMutate()) return false;
        if (!available) return false;
        const question = text.trim();
        if (!question && !btwOpenTargetTurnId(turns, blocks, harness, managed)) {
          const existing = tabs.find((tab) => tab.id === activeTabId) ?? tabs[tabs.length - 1];
          if (!existing) return false;
          setActiveId(existing.id);
          setSeed((current) => ({
            key: current.key + 1,
            text: draftTextsRef.current[existing.id] ?? "",
          }));
          setRequestedOpen(true);
          return true;
        }
        const previousActiveId = activeTabId;
        const tab = startDraft();
        if (!tab) return false;
        if (options?.draft) {
          setRequestedOpen(true);
          draftTextsRef.current[tab.id] = text;
          setSeed((current) => ({ key: current.key + 1, text }));
          return true;
        }
        const tabModel = baseModelFor(tab);
        const tabHarness = tabHarnessFor(blocks, tab, harness);
        if (question && tabHarness) {
          const accepted = send(
            tab,
            question,
            tabModel,
            preferredModelSettings(resolveModel(tabHarness, tabModel), modelSettings),
            text,
            original,
          );
          if (!accepted) {
            setDrafts((current) => current.filter((entry) => entry.id !== tab.id));
            delete draftTextsRef.current[tab.id];
            setActiveId(previousActiveId);
            return false;
          }
        }
        setRequestedOpen(true);
        return true;
      };
      return original ? parentChanged.continue(original, operation) : operation();
    },
  );

  // Stable so its `preferredModelSettings` read stays an event-time read, not a render-time one.
  const changeModel = useStableCallback((nextHarness: HarnessId, nextModel: string) => {
    if (!parentChanged.canMutate()) return;
    if (nextHarness !== composerHarness) return;
    const nextSettings = preferredModelSettings(
      resolveModel(nextHarness, nextModel),
      selectedModelSettings,
    );
    setDraftModel(nextModel);
    setDraftModelSettings(nextSettings);
    if (persisted && active) {
      onModelChange?.(active.turn, active.id, nextModel, nextSettings);
    }
  });

  return {
    parentSessionId,
    open,
    rendered,
    tabs,
    activeTabId,
    persisted,
    messages,
    pendingBlocks: persisted?.pendingBlocks ?? NO_BLOCKS,
    running,
    harness: composerHarness,
    canAsk: !inputClosed && tabHarness != null,
    canAskCurrentTarget: available && tabHarness != null,
    inputClosed,
    seed,
    model: selectedModel,
    modelSettings: selectedModelSettings,
    canStartDraft: !inputClosed && btwOpenTargetTurnId(turns, blocks, harness, managed) != null,
    finishClose,
    selectTab,
    openWith,
    startDraft() {
      startDraft();
    },
    changeDraft(text: string) {
      if (!canPublishParentInput(parentSessionId)) return;
      if (activeTabId) draftTextsRef.current[activeTabId] = text;
      parentChanged();
    },
    close() {
      parentChanged();
      setRequestedOpen(false);
    },
    /** False keeps the text in the composer. */
    submit(text: string, original?: ParentAdmission): boolean {
      const question = text.trim();
      if (!available || !question || running || !active || !tabHarness) return false;
      return send(active, question, selectedModel, selectedModelSettings, text, original);
    },
    closeTab(tab: BtwTab) {
      if (!parentChanged.canMutate()) return;
      const remaining = tabs.filter((entry) => entry.id !== tab.id);
      setDrafts((current) => current.filter((entry) => entry.id !== tab.id));
      if (tab.thread) onDelete?.(tab.turn, tab.id);
      delete draftTextsRef.current[tab.id];
      if (remaining.length === 0) {
        setRequestedOpen(false);
        return;
      }
      if (tab.id === activeTabId) {
        const index = tabs.findIndex((entry) => entry.id === tab.id);
        selectTab(remaining[Math.min(index, remaining.length - 1)].id);
      }
    },
    /** Stop the active tab's streaming answer, keeping what arrived. */
    stop() {
      parentChanged();
      if (!active) return;
      setOptimistic((current) => (current?.threadId === active.id ? null : current));
      if (persisted?.status === "running") onStop?.(active.turn, active.id);
    },
    retry() {
      if (!parentChanged.canMutate()) return;
      if (active && persisted) onRetry(active.turn, persisted.id);
    },
    changeModel,
    changeModelSettings(nextSettings: Record<string, string>) {
      if (!parentChanged.canMutate()) return;
      setDraftModelSettings(nextSettings);
      if (persisted && active) {
        onModelChange?.(active.turn, active.id, selectedModel, nextSettings);
      }
    },
  };
}

/** Side conversation with immediate presentation and retained thread/draft ownership. */
export function BtwSheet({
  btw,
  cwd,
  providerAccountId,
  visible = true,
  onSaveNote,
  onOpenFile,
  onOpenDiff,
}: {
  btw: BtwConversation;
  cwd?: string;
  providerAccountId?: string;
  visible?: boolean;
  /** Retained caller compatibility; presentation no longer morphs from the composer. */
  origin?: () => HTMLElement | null;
  onSaveNote?: (text: string) => void | Promise<void>;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const sheetRef = useRef<HTMLElement | null>(null);
  const { open, rendered, tabs, activeTabId, messages, persisted, running } = btw;
  const harness = btw.harness;
  const finishClose = btw.finishClose;
  // The side thread renders through the main transcript, so it anchors,
  // follows, and folds its work exactly like the conversation behind it.
  const threadBlocks = useMemo(
    () =>
      btwThreadBlocks({
        messages,
        pendingBlocks: btw.pendingBlocks,
        running,
        updatedAt: persisted?.updatedAt,
        harness,
        model: btw.model,
      }),
    [messages, btw.pendingBlocks, running, persisted?.updatedAt, harness, btw.model],
  );

  // Frequent side questions should be usable immediately, without delaying the
  // composer behind geometry animations or decorative completion effects.
  useLayoutEffect(() => {
    if (rendered && !open) finishClose();
  }, [open, rendered, finishClose]);

  // Focus follows the sheet in, so typing goes to the side question. Escape and outside
  // presses belong to the shared Sheet.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !visible || !sheet) return;
    const frame = requestAnimationFrame(() => {
      if (!sheet.contains(document.activeElement)) {
        sheet.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, visible, activeTabId, btw.seed.key]);

  if (!rendered) return null;

  return (
    <Sheet
      padding="none"
      ref={sheetRef}
      modal={false}
      anchor="container"
      side="bottom"
      open={open && visible}
      motion="none"
      initialFocus={false}
      scroll="none"
      title={t("By-the-way conversations")}
      escapeScope="[data-session-drop]"
      className="btw-sheet"
      bodyClassName="font-sans"
      bodyText={{ size: "body" }}
      onClose={btw.close}
      header={
        <div
          {...surfaceAttributes(
            { frame: "neutral", edge: "bottom" },
            "flex h-11 shrink-0 items-center gap-1  border-(--ui-tone-neutral-border) pr-2 pl-2.5",
          )}
        >
          <Tabs value={activeTabId ?? ""} onValueChange={btw.selectTab} panels="none">
            <TabList
              label={t("Side questions")}
              scrollbar="hidden"
              className="min-w-0 flex-1 overflow-x-auto"
            >
              {tabs.map((tab) => {
                const selected = tab.id === activeTabId;
                const label = compactQuestion(tab.question);
                return (
                  <ActionHost
                    key={tab.id}
                    selected={selected}
                    {...surfaceAttributes(
                      { radius: "row" },
                      "flex max-w-[15rem] shrink-0 items-center",
                    )}
                  >
                    <Tab value={tab.id} tooltip={tab.question} className="min-w-0">
                      {tab.status ? <BtwStatusDot status={tab.status} /> : null}
                      <Text size="inherit" tone="inherit" truncate>
                        {label}
                      </Text>
                    </Tab>
                    <InlineAction
                      className="mr-1 shrink-0"
                      tabIndex={selected ? 0 : -1}
                      label={
                        tab.thread ? t("Delete “{p0}”", { p0: label }) : t("Discard new question")
                      }
                      type="button"
                      tooltip={tab.thread ? t("Delete") : t("Discard")}
                      onClick={() => btw.closeTab(tab)}
                    >
                      <X className="icon-xs" strokeWidth={1.75} />
                    </InlineAction>
                  </ActionHost>
                );
              })}
            </TabList>
          </Tabs>
          {btw.canStartDraft ? (
            <Button
              iconOnly
              label={t("New side question")}
              variant="ghost"
              type="button"
              onClick={btw.startDraft}
              className="shrink-0"
            >
              <Plus className="icon-sm" strokeWidth={1.75} />
            </Button>
          ) : null}
          <Button
            iconOnly
            label={t("Back to the conversation")}
            variant="ghost"
            type="button"
            shortcut="Esc"
            onClick={btw.close}
            className="shrink-0"
          >
            <ChevronDown className="icon-md" strokeWidth={1.75} />
          </Button>
        </div>
      }
    >
      <div className="min-h-0 flex-1">
        <AgentTranscript
          key={activeTabId ?? ""}
          blocks={threadBlocks}
          busy={running}
          visible={visible && open}
          cwd={cwd}
          harness={harness}
          model={btw.model}
          modelSettings={btw.modelSettings}
          providerAccountId={providerAccountId}
          onSaveNote={onSaveNote}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      </div>
      {persisted?.status === "error" ? (
        <div className="shrink-0 px-5 pb-3">
          <Alert tone="danger">
            <div className="min-w-0">
              <Text as="div" size="caption" tone="danger" weight="medium">
                {t("Couldn’t finish")}
              </Text>
              <Text as="div" tone="danger" leading="normal" className="mt-1">
                {persisted.error ||
                  t("{p0} could not answer this side question.", {
                    p0: HARNESS_TITLE[harness],
                  })}
              </Text>
            </div>
            <Button variant="ghost" type="button" onClick={btw.retry} className="shrink-0">
              <RefreshCw className="icon-xs" strokeWidth={1.75} />
              {t("Retry")}
            </Button>
          </Alert>
        </div>
      ) : null}

      {/* Keep the same inset as the docked composer. */}
      <div className="shrink-0 p-1.5 pt-0">
        {activeTabId ? (
          <Composer
            key={`${activeTabId}:${btw.seed.key}`}
            compact
            enabled={visible && open}
            disabled={!btw.canAskCurrentTarget}
            focused={visible && open && !running}
            harness={harness}
            model={btw.model}
            modelSettings={btw.modelSettings}
            runtimeMode={DEFAULT_RUNTIME_MODE}
            cwd={cwd ?? "~"}
            executionCwd={cwd ?? "~"}
            sessionId={activeTabId}
            parentSessionId={btw.parentSessionId ?? null}
            hideProjectPicker
            hideBranchPicker
            hideTopBar
            placeholder={t("Ask a side question…")}
            inputAriaLabel="By-the-way question"
            allowedModelHarnesses={[harness]}
            initialDraft={btw.seed.text}
            onDraftChange={btw.changeDraft}
            onFocus={() => {}}
            onCwdChange={() => {}}
            onModelChange={btw.changeModel}
            onModelSettingsChange={btw.changeModelSettings}
            onRuntimeModeChange={() => {}}
            busy={running}
            allowBusySubmit={false}
            onStop={btw.stop}
            onSubmit={(text, _attachments, _options, original) => btw.submit(text, original)}
          />
        ) : null}
      </div>
    </Sheet>
  );
}
