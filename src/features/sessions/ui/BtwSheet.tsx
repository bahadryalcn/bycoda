import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, RefreshCw, X } from "../../../shared/ui/icons";

import { Composer } from "./Composer";
import { AgentTranscript } from "./AgentTranscript";
import { GlassBackdrop } from "../../../app/shell/GlassBackdrop";
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

type Options = {
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
  const [requestedOpen, setRequestedOpen] = useState(false);
  const open = requestedOpen && available;
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

  const turns = useMemo(() => groupTurns(blocks, managed), [blocks, managed]);
  const entries = useMemo(() => sessionBtwThreads(blocks, managed), [blocks, managed]);
  const tabs = useMemo(() => {
    const next: BtwTab[] = entries.map(({ thread, turn }) => ({
      id: thread.id,
      turn,
      thread,
    }));
    for (const draft of drafts) {
      if (next.some((tab) => tab.id === draft.id)) continue;
      const turn = turns.find((entry) => entry[0]?.id === draft.turnId);
      if (turn) next.push({ id: draft.id, turn });
    }
    return next.map((tab) => {
      const pending = optimistic?.threadId === tab.id ? optimistic : null;
      return {
        ...tab,
        question:
          tab.thread?.messages.find((message) => message.role === "user")?.text ??
          pending?.message.text,
        status: tab.thread?.status ?? (pending ? "running" : undefined),
      };
    });
  }, [drafts, entries, optimistic, turns]);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1];
  const activeTabId = active?.id ?? null;
  const persisted = active?.thread;
  const tabHarness = active ? tabHarnessFor(blocks, active, harness) : undefined;
  const composerHarness = tabHarness ?? harness;
  const baseModelFor = (tab: BtwTab) =>
    tab.turn.find((block) => block.role === "user")?.turnModel?.id ?? model;

  const optimisticForTab = optimistic?.threadId === activeTabId ? optimistic.message : undefined;
  const persistedMessages = persisted?.messages ?? NO_MESSAGES;
  // Stable while nothing changes, so the transcript is not re-fed each render.
  const messages = useMemo(
    () =>
      optimisticForTab && !persistedMessages.some((message) => message.id === optimisticForTab.id)
        ? [...persistedMessages, optimisticForTab]
        : persistedMessages,
    [optimisticForTab, persistedMessages],
  );
  const running = persisted?.status === "running" || !!optimisticForTab;
  const selectedModel = draftModel ?? persisted?.model ?? (active ? baseModelFor(active) : model);
  const selectedModelSettings = useMemo(() => {
    if (draftModelSettings) return draftModelSettings;
    if (persisted?.modelSettings) return persisted.modelSettings;
    return preferredModelSettings(resolveModel(composerHarness, selectedModel), modelSettings);
  }, [composerHarness, draftModelSettings, modelSettings, persisted?.modelSettings, selectedModel]);

  useEffect(() => {
    if (!available) setRequestedOpen(false);
  }, [available]);

  useEffect(() => {
    if (
      optimistic &&
      entries.some(
        ({ thread }) =>
          thread.id === optimistic.threadId &&
          thread.messages.some((message) => message.id === optimistic.message.id),
      )
    ) {
      setOptimistic(null);
    }
  }, [optimistic, entries]);

  useEffect(() => {
    const persistedIds = new Set(entries.map(({ thread }) => thread.id));
    setDrafts((current) => {
      const pending = current.filter((draft) => !persistedIds.has(draft.id));
      return pending.length === current.length ? current : pending;
    });
  }, [entries]);

  const finishClose = () => {
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

  const send = (
    tab: BtwTab,
    text: string,
    nextModel: string,
    nextSettings: Record<string, string>,
  ): boolean => {
    const messageId = crypto.randomUUID();
    const accepted = onSubmit(
      tab.turn,
      tab.id,
      messageId,
      text,
      nextModel || undefined,
      nextSettings,
    );
    if (accepted === false) return false;
    setOptimistic({
      threadId: tab.id,
      message: { id: messageId, role: "user", text, createdAt: Date.now() },
    });
    return true;
  };

  // A new tab reads from the latest finished turn at the moment it opens.
  const startDraft = (): BtwTab | null => {
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
    if (id === activeTabId) return;
    setDraftModel(null);
    setDraftModelSettings(null);
    setActiveId(id);
    setSeed((current) => ({
      key: current.key + 1,
      text: draftTextsRef.current[id] ?? "",
    }));
  };

  return {
    open,
    rendered,
    tabs,
    activeTabId,
    persisted,
    messages,
    pendingBlocks: persisted?.pendingBlocks ?? NO_BLOCKS,
    running,
    harness: composerHarness,
    canAsk: tabHarness != null,
    seed,
    model: selectedModel,
    modelSettings: selectedModelSettings,
    canStartDraft: btwOpenTargetTurnId(turns, blocks, harness, managed) != null,
    finishClose,
    selectTab,
    /**
     * Open a new tab. `text` is sent right away, or left unsent in the side
     * composer with `draft`.
     */
    openWith(text: string, options?: { draft?: boolean }): boolean {
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
    },
    startDraft() {
      startDraft();
    },
    changeDraft(text: string) {
      if (activeTabId) draftTextsRef.current[activeTabId] = text;
    },
    close() {
      setRequestedOpen(false);
    },
    /** False keeps the text in the composer. */
    submit(text: string): boolean {
      const question = text.trim();
      if (!question || running || !active || !tabHarness) return false;
      return send(active, question, selectedModel, selectedModelSettings);
    },
    closeTab(tab: BtwTab) {
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
      if (!active) return;
      setOptimistic((current) => (current?.threadId === active.id ? null : current));
      if (persisted?.status === "running") onStop?.(active.turn, active.id);
    },
    retry() {
      if (active && persisted) onRetry(active.turn, persisted.id);
    },
    changeModel(nextHarness: HarnessId, nextModel: string) {
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
    },
    changeModelSettings(nextSettings: Record<string, string>) {
      setDraftModelSettings(nextSettings);
      if (persisted && active) {
        onModelChange?.(active.turn, active.id, selectedModel, nextSettings);
      }
    },
  };
}

function compactQuestion(text: string | undefined): string {
  const compact = text?.replace(/\s+/g, " ").trim() || "New question";
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}

function statusClass(status: BtwThread["status"]): string {
  if (status === "running") return "bg-(--ui-tone-warning-subtle)";
  if (status === "error") return "bg-(--ui-tone-danger-subtle)";
  return "bg-(--ui-tone-success-subtle)";
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
  const glassRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
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

  // Esc collapses the sheet from anywhere in this pane, and focus follows
  // the sheet in so typing goes to the side question.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !visible || !sheet) return;
    const frame = requestAnimationFrame(() => {
      if (!sheet.contains(document.activeElement)) {
        sheet.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      }
    });
    const pane = sheet.closest("[data-session-drop]") ?? sheet.parentElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target !== document.body && !(target && pane?.contains(target))) {
        return;
      }
      event.preventDefault();
      btw.close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, visible, activeTabId, btw.seed.key]);

  if (!rendered) return null;

  return (
    <div
      data-btw-overlay
      data-state={open ? "open" : "closed"}
      inert={!open}
      ref={overlayRef}
      className="btw-overlay absolute inset-0 z-40"
    >
      <div aria-hidden className="absolute inset-0" onMouseDown={btw.close} />
      <section
        ref={sheetRef}
        role="dialog"
        aria-label={t("By-the-way conversations")}
        className="btw-sheet absolute inset-x-0 bottom-0 isolate mx-auto w-full max-w-4xl"
      >
        <GlassBackdrop ref={glassRef} className="btw-sheet-glass popover-backdrop" />
        <div
          ref={contentRef}
          className="relative z-[1] flex h-full flex-col font-sans text-sm text-(--ui-tone-neutral-fg)"
        >
          <div className="btw-sheet-body flex h-11 shrink-0 items-center gap-1 border-b border-(--ui-tone-neutral-border) pr-2 pl-2.5">
            <div
              role="tablist"
              aria-label={t("Side questions")}
              className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            >
              {tabs.map((tab) => {
                const selected = tab.id === activeTabId;
                const label = compactQuestion(tab.question);
                return (
                  <div
                    key={tab.id}
                    className={`group flex h-7 max-w-[15rem] shrink-0 items-center rounded-md transition-colors ${
                      selected
                        ? "bg-(--ui-surface-raised) text-(--ui-tone-neutral-fg)"
                        : "text-(--ui-text-secondary) hover:bg-(--ui-surface-raised) hover:text-(--ui-text-secondary)"
                    }`}
                  >
                    <Button
                      variant="tab"
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      title={tab.question}
                      onClick={() => btw.selectTab(tab.id)}
                      onKeyDown={(event) => {
                        if (event.altKey || event.ctrlKey || event.metaKey) return;
                        const index = tabs.findIndex((item) => item.id === tab.id);
                        const next =
                          event.key === "ArrowLeft"
                            ? (index + tabs.length - 1) % tabs.length
                            : event.key === "ArrowRight"
                              ? (index + 1) % tabs.length
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? tabs.length - 1
                                  : -1;
                        if (next < 0) return;
                        event.preventDefault();
                        btw.selectTab(tabs[next].id);
                        event.currentTarget
                          .closest('[role="tablist"]')
                          ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                          [next]?.focus();
                      }}
                      className="min-w-0"
                    >
                      {tab.status ? (
                        <span
                          aria-hidden
                          className={`size-1.5 shrink-0 rounded-full ${statusClass(tab.status)}`}
                        />
                      ) : null}
                      <span className="truncate">{label}</span>
                    </Button>
                    <Button
                      className={`mr-1 shrink-0 focus-visible:opacity-100 ${selected ? "" : "opacity-0 group-hover:opacity-100"}`}
                      selected={selected}
                      tabIndex={selected ? 0 : -1}
                      iconOnly
                      label={
                        tab.thread ? t("Delete “{p0}”", { p0: label }) : t("Discard new question")
                      }
                      variant="ghost"
                      type="button"
                      aria-label={
                        tab.thread ? t("Delete “{p0}”", { p0: label }) : t("Discard new question")
                      }
                      title={tab.thread ? t("Delete") : t("Discard")}
                      onClick={() => btw.closeTab(tab)}
                    >
                      <X className="size-3" strokeWidth={1.75} />
                    </Button>
                  </div>
                );
              })}
            </div>
            {btw.canStartDraft ? (
              <Button
                iconOnly
                label={t("New side question")}
                variant="ghost"
                type="button"
                aria-label={t("New side question")}
                title={t("New side question")}
                onClick={btw.startDraft}
                className="shrink-0"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
              </Button>
            ) : null}
            <Button
              iconOnly
              label={t("Back to the conversation")}
              variant="ghost"
              type="button"
              aria-label={t("Back to the conversation")}
              title={t("Back to the conversation (Esc)")}
              onClick={btw.close}
              className="shrink-0"
            >
              <ChevronDown className="size-4" strokeWidth={1.75} />
            </Button>
          </div>

          <div className="btw-sheet-body min-h-0 flex-1">
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
            <div className="btw-sheet-body shrink-0 px-5 pb-3">
              <Alert tone="danger" role="alert">
                <div className="min-w-0">
                  <div className="text-(length:--ui-font-caption) font-medium text-(--ui-tone-danger-fg)">
                    {t("Couldn’t finish")}
                  </div>
                  <div className="mt-1 text-ui-caption leading-4.5 text-(--ui-tone-danger-fg)">
                    {persisted.error ||
                      t("{p0} could not answer this side question.", {
                        p0: HARNESS_TITLE[harness],
                      })}
                  </div>
                </div>
                <Button variant="ghost" type="button" onClick={btw.retry} className="shrink-0">
                  <RefreshCw className="size-3" strokeWidth={1.75} />
                  {t("Retry")}
                </Button>
              </Alert>
            </div>
          ) : null}

          {/* Keep the same inset as the docked composer. */}
          <div className="btw-sheet-composer shrink-0 p-1.5 pt-0">
            {activeTabId ? (
              <Composer
                key={`${activeTabId}:${btw.seed.key}`}
                compact
                enabled={visible && open}
                disabled={!btw.canAsk}
                focused={visible && open && !running}
                harness={harness}
                model={btw.model}
                modelSettings={btw.modelSettings}
                runtimeMode={DEFAULT_RUNTIME_MODE}
                cwd={cwd ?? "~"}
                executionCwd={cwd ?? "~"}
                sessionId={activeTabId}
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
                onSubmit={(text) => btw.submit(text)}
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
