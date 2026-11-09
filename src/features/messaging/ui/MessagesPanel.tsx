import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Sash } from "../../../shared/ui/Sash";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { ChevronLeft, MessageMultiple, RefreshCw, Search } from "../../../shared/ui/icons";
import { useMessageThreads } from "../hooks/useMessageThreads";
import { useWindowActive } from "../hooks/useWindowActive";
import {
  DEFAULT_MESSAGE_FILTERS,
  filterThreads,
  markThreadSeen,
  messageFilterCount,
  pruneMessageFilters,
  threadKey,
  type MessageFilters,
} from "../model/messageThreads";
import { openMessagingSettings } from "../model/messagingSettings";
import type { MessageThread, MessagingAccount, ThreadMessage } from "../model/messagingTypes";
import { MessageThreadList } from "./MessageThreadList";
import { MessageThreadView } from "./MessageThreadView";
import { MessagesFilterMenu } from "./MessagesFilterMenu";

const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 320;
let rememberedWidth = DEFAULT_WIDTH;
const ERROR_GRAPHEMES = 160;

/**
 * The Inbox "Messages" source: conversations of every messaging account in one list
 * with a reading pane. Reuses the Inbox list/detail layout classes, so a narrow Inbox
 * shows the list or the conversation with a Back button.
 */
export function MessagesPanel({
  accounts,
  sourceRow,
}: {
  accounts: MessagingAccount[];
  /** The Inbox source tabs, shown at the top of the list column like other sources. */
  sourceRow: ReactNode;
}) {
  useLocale();
  const active = useWindowActive();
  const { threads, failures, loading, loaded, refresh, patchThread } = useMessageThreads(
    accounts,
    active,
  );
  const [search, setSearch] = useRetainedState("inbox:messages:search", "");
  const deferredSearch = useDeferredValue(search);
  const [savedFilters, setFilters] = useRetainedState<MessageFilters>(
    "inbox:messages:filters",
    DEFAULT_MESSAGE_FILTERS,
  );
  const filters = useMemo(
    () => pruneMessageFilters(savedFilters, accounts),
    [savedFilters, accounts],
  );
  const [selectedKey, setSelectedKey] = useRetainedState<string | null>(
    "inbox:messages:selected",
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLButtonElement>(null);
  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.5)),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });

  const visible = useMemo(
    () => filterThreads(threads, filters, deferredSearch),
    [threads, filters, deferredSearch],
  );
  const filterCount = messageFilterCount(filters);
  const narrowed = filterCount > 0 || search.trim().length > 0;
  const selected =
    threads.find((thread) => threadKey(thread) === selectedKey) ??
    (selectedKey ? null : (visible[0] ?? null));
  const selectedAccount = selected
    ? accounts.find((account) => account.id === selected.accountId)
    : undefined;
  const accountLabels = useMemo(
    () =>
      accounts.length > 1
        ? new Map(accounts.map((account) => [account.id, account.label || account.identity]))
        : null,
    [accounts],
  );
  const disconnected = accounts.filter((account) => !account.connected);
  const connectedCount = accounts.length - disconnected.length;
  const allFailed = connectedCount > 0 && failures.length === connectedCount;

  const selectThread = (thread: MessageThread) => {
    markThreadSeen(thread);
    setSelectedKey(threadKey(thread));
    setDetailOpen(true);
  };
  const onSent = (thread: MessageThread, message: ThreadMessage) => {
    const patch = { preview: message.body, updatedAt: message.at || Date.now(), unread: false };
    patchThread(thread, patch);
    markThreadSeen({ ...thread, ...patch });
  };
  const resetNarrowing = () => {
    setFilters(DEFAULT_MESSAGE_FILTERS);
    setSearch("");
  };

  const listBody =
    connectedCount === 0 ? (
      <EmptyState
        kind="unavailable"
        icon={<MessageMultiple aria-hidden="true" />}
        description={t("Reconnect a messaging account to read its conversations.")}
        action={
          <Button variant="secondary" type="button" onClick={openMessagingSettings}>
            {t("Open settings")}
          </Button>
        }
      />
    ) : threads.length === 0 && allFailed ? (
      <EmptyState
        kind="unavailable"
        icon={<MessageMultiple aria-hidden="true" />}
        description={t("Could not load messages.")}
        onRetry={refresh}
        retrying={loading}
      />
    ) : threads.length === 0 && (loading || !loaded) ? (
      <LoadingText className="justify-center py-10" />
    ) : visible.length === 0 ? (
      narrowed ? (
        <EmptyState
          kind="filtered"
          icon={<MessageMultiple aria-hidden="true" />}
          description={t("No conversations match these filters.")}
          onReset={resetNarrowing}
          resetLabel={t("Clear filters")}
        />
      ) : (
        <EmptyState
          kind="empty"
          icon={<MessageMultiple aria-hidden="true" />}
          description={t("No conversations yet.")}
        />
      )
    ) : (
      <MessageThreadList
        threads={visible}
        selectedKey={selected ? threadKey(selected) : null}
        stateKey={`inbox:messages:${JSON.stringify(filters)}`}
        accountLabels={accountLabels}
        onSelect={selectThread}
      />
    );

  return (
    <div className="inbox-list-detail flex min-h-0 min-w-0 flex-1" data-detail-open={detailOpen}>
      <div
        ref={resize.setPaneRef}
        className="inbox-list-panel relative flex h-full min-h-0 shrink-0 flex-col border-r border-(--ui-pane-border) bg-transparent"
      >
        {sourceRow}
        <div className="flex h-9 shrink-0 items-center gap-1 px-2">
          <SearchInputGroup appearance="field" className="min-w-0 flex-1">
            <Search className="pointer-events-none icon-xs shrink-0 text-(--ui-text-secondary)" />
            <SearchInput
              focusOwner="group"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Filter conversations")}
              aria-label={t("Filter conversations")}
              spellCheck={false}
              autoComplete="off"
            />
          </SearchInputGroup>
          <FilterTrigger
            ref={filterRef}
            label={filterCount > 0 ? t("Filter messages (filters active)") : t("Filter messages")}
            activeCount={filterCount}
            onReset={() => setFilters(DEFAULT_MESSAGE_FILTERS)}
            resetLabel={t("Clear filters")}
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          />
          <Button
            iconOnly
            label={t("Refresh messages")}
            variant="ghost"
            type="button"
            loading={loading}
            onClick={refresh}
            className="shrink-0"
          >
            <RefreshCw className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
        {failures.length > 0 && !(threads.length === 0 && allFailed) ? (
          <div className="flex shrink-0 flex-col gap-1 px-3 py-1">
            {failures.map(({ account, error }) => (
              <InlineMessage
                key={account.id}
                tone="warning"
                title={error}
                retry={{ onRetry: refresh, pending: loading }}
              >
                {t("Could not refresh {p0}: {p1}", {
                  p0: account.label || account.identity,
                  p1: truncateGraphemes(error, ERROR_GRAPHEMES),
                })}
              </InlineMessage>
            ))}
          </div>
        ) : null}
        {connectedCount > 0 && disconnected.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-1 px-3 py-1">
            {disconnected.map((account) => (
              <InlineMessage
                key={account.id}
                tone="neutral"
                live="off"
                action={
                  <Button variant="link" layout="text" onClick={openMessagingSettings}>
                    {t("Open settings")}
                  </Button>
                }
              >
                {t("{p0} is not connected.", { p0: account.label || account.identity })}
              </InlineMessage>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listBody}</div>
        <Sash
          {...resize.sashProps}
          appearance="hidden"
          label={t("Resize conversation list")}
          className="absolute inset-y-0 -right-px"
        />
      </div>
      <div className="inbox-detail-pane flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="inbox-detail-back shrink-0 border-b border-(--ui-tone-neutral-border) px-2 py-1">
          <Button variant="ghost" onClick={() => setDetailOpen(false)}>
            <ChevronLeft className="icon-sm" aria-hidden="true" />
            {t("Back")}
          </Button>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {selected ? (
            <MessageThreadView
              key={threadKey(selected)}
              thread={selected}
              account={selectedAccount}
              onSent={onSent}
            />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={<MessageMultiple aria-hidden="true" />}
                description={t("Select a conversation")}
              />
            </div>
          )}
        </div>
      </div>
      {filterOpen ? (
        <MessagesFilterMenu
          anchor={filterRef}
          accounts={accounts}
          filters={filters}
          onChange={setFilters}
          onManageAccounts={openMessagingSettings}
          onClose={() => setFilterOpen(false)}
        />
      ) : null}
    </div>
  );
}
