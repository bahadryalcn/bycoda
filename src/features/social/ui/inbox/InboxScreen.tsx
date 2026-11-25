import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { socialQueryScope } from "../../model/socialQuery";
import { Switch } from "../../../../shared/ui/Switch";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import type { SocialScreenProps } from "../shell/screens";
import { inboxApi } from "./inboxApi";
import { matchesInboxText } from "./inboxRefresh";
import { InboxFilters } from "./InboxFilters";
import { InboxList } from "./InboxList";
import { UnreadableNotice } from "./InboxNotices";
import { ConversationView } from "./ConversationView";
import type { InboxFilterState } from "./inboxTypes";
import { useInboxAccounts, useInboxInvalidate, useInboxList } from "./useInboxData";
import "./inbox.css";

const NO_FILTER: InboxFilterState = { status: "all", accountId: "", query: "" };

/** A thread id passed in by navigation (for example from a notification or the shell). */
function targetThreadId(target: unknown): string | undefined {
  if (!target || typeof target !== "object" || !("threadId" in target)) return undefined;
  return typeof target.threadId === "string" ? target.threadId : undefined;
}

/** Unified inbox: filters, one list of comments and messages, the selected conversation and a reply box. */
export function InboxScreen(props: SocialScreenProps) {
  return <HostInboxScreen key={socialQueryScope(props.client).join(":")} {...props} />;
}

function HostInboxScreen({ client, active, target, onNavigate }: SocialScreenProps) {
  useLocale();
  const api = inboxApi(client);
  const invalidate = useInboxInvalidate(client);
  const snapshot = useInboxAccounts(client, active);
  const [filter, setFilter] = useState<InboxFilterState>(NO_FILTER);
  const [chosen, setChosen] = useState<string | undefined>(() => targetThreadId(target));
  /** Last selected thread the list has shown; proves a later absence is a removal. */
  const [seenId, setSeenId] = useState<string>();
  const [lastTarget, setLastTarget] = useState(target);
  // Retained screens receive navigation occurrences without remounting reply drafts.
  if (target !== lastTarget) {
    setLastTarget(target);
    const threadId = targetThreadId(target);
    if (threadId) setChosen(threadId);
  }
  const [settingsError, setSettingsError] = useState("");
  const [checking, setChecking] = useState(false);
  const [savingRefresh, setSavingRefresh] = useState(false);

  const autoRefresh = snapshot.data?.pollingEnabled;
  const list = useInboxList(client, filter, {
    enabled: active,
    refresh: active && autoRefresh === true,
  });
  const loadedItems = list.data?.pages.flatMap((page) => page.items) ?? [];
  const needle = filter.query.trim().toLocaleLowerCase();
  // Preview the Host's unified text match over already loaded rows until its full search returns.
  const items =
    list.isPlaceholderData && needle
      ? loadedItems.filter((item) => matchesInboxText(item, needle))
      : loadedItems;
  const unreadable = list.data?.pages[0]?.unreadable ?? [];
  const accounts = snapshot.data?.accounts ?? [];
  const names = Object.fromEntries(accounts.map((account) => [account.id, account.name]));
  const accountOptions = accounts.map((account) => ({ value: account.id, label: account.name }));
  const selectedId = chosen;
  const selectedItem = loadedItems.find((item) => item.threadId === selectedId);
  // The list is only trusted to say a conversation is gone once every page is loaded and no
  // refresh is in flight; a not-yet-listed navigation target is kept until it has been seen.
  const listSettled =
    list.isSuccess && !list.isPlaceholderData && !list.isFetching && !list.hasNextPage;
  // Selection is pinned in state, so a refresh that reorders rows never swaps the open
  // conversation. It only moves when nothing is open yet or the open one left the list.
  if (selectedId === undefined) {
    if (items[0]) setChosen(items[0].threadId);
  } else if (selectedItem) {
    if (seenId !== selectedId) setSeenId(selectedId);
  } else if (listSettled && seenId === selectedId) {
    setSeenId(undefined);
    setChosen(items[0]?.threadId);
  }
  const filtered = filter.status !== "all" || filter.accountId !== "" || filter.query.trim() !== "";

  const toggleAutoRefresh = async (next: boolean) => {
    setSavingRefresh(true);
    setSettingsError("");
    try {
      await api.setAutoRefresh(next);
      await invalidate({ reference: true });
    } catch {
      setSettingsError(t("Could not change auto-refresh. Try again."));
    } finally {
      setSavingRefresh(false);
    }
  };

  // Asks each connected account for new activity, then reloads the list. Failures are counted, not hidden.
  const checkNow = async () => {
    setChecking(true);
    setSettingsError("");
    try {
      const results = await Promise.allSettled(
        accounts
          .filter((account) => account.connected)
          .map((account) => client.request("inbox.sync", { accountId: account.id })),
      );
      if (results.some((result) => result.status === "rejected"))
        setSettingsError(t("Some accounts could not be checked. Open an account to see why."));
      await invalidate({ reference: true });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="inbox-screen" aria-label={t("Inbox")}>
      {settingsError ? <InlineError>{settingsError}</InlineError> : null}
      <UnreadableNotice
        accounts={unreadable}
        names={names}
        action={{ label: t("Manage accounts"), onClick: () => onNavigate("accounts") }}
      />
      <InboxFilters value={filter} accounts={accountOptions} onChange={setFilter}>
        <Text
          as="div"
          size="secondary"
          tone="secondary"
          leading="inherit"
          className="inbox-refresh"
        >
          <span>{t("Auto-refresh")}</span>
          <Switch
            aria-label={t("Auto-refresh")}
            compact
            checked={autoRefresh === true}
            disabled={autoRefresh === undefined || savingRefresh}
            onCheckedChange={(next) => void toggleAutoRefresh(next).catch(() => undefined)}
          />
        </Text>
        {accounts.some((account) => account.connected) ? (
          <Button
            variant="secondary"
            size="sm"
            loading={checking}
            loadingLabel={t("Checking…")}
            onClick={() =>
              void checkNow().catch(() =>
                setSettingsError(t("Could not load the inbox. Try again.")),
              )
            }
          >
            {t("Check now")}
          </Button>
        ) : null}
      </InboxFilters>

      {snapshot.isError ? (
        <InlineError
          retry={{
            label: t("Try again"),
            pending: snapshot.isFetching,
            onRetry: () => {
              void snapshot.refetch().catch(() => undefined);
            },
          }}
        >
          {t("Could not load accounts. Try again.")}
        </InlineError>
      ) : null}
      {list.isError ? (
        <InlineError
          retry={{
            label: t("Try again"),
            pending: list.isFetching,
            onRetry: () => {
              void list.refetch().catch(() => undefined);
            },
          }}
        >
          {t("Could not load the inbox. Try again.")}
        </InlineError>
      ) : null}

      <div className="inbox-body">
        <div className="inbox-column">
          {!list.isPending &&
          !list.isPlaceholderData &&
          items.length === 0 &&
          !list.isError &&
          !snapshot.isError ? (
            snapshot.isPending ? (
              <LoadingText>{t("Loading accounts…")}</LoadingText>
            ) : accounts.length === 0 ? (
              <EmptyState
                kind="empty"
                description={t("Add an account to read messages and comments.")}
                action={{ label: t("Add account"), onClick: () => onNavigate("accounts") }}
              />
            ) : filtered ? (
              <EmptyState
                kind="filtered"
                description={t("No conversations match these filters.")}
                onReset={() => setFilter(NO_FILTER)}
                resetLabel={t("Clear filters")}
              />
            ) : unreadable.length === 0 && !accounts.some((account) => account.connected) ? (
              <EmptyState
                kind="empty"
                description={t("Connect an account to check for new conversations.")}
                action={{ label: t("Manage accounts"), onClick: () => onNavigate("accounts") }}
              />
            ) : (
              <EmptyState
                kind="empty"
                description={t("No conversations yet. New messages and comments appear here.")}
              />
            )
          ) : (
            <InboxList
              items={items}
              selectedId={selectedId}
              stateKey={[...socialQueryScope(client), filter.accountId, filter.status].join(":")}
              loading={list.isPending || (list.isPlaceholderData && !items.length)}
              hasMore={!list.isPlaceholderData && list.hasNextPage}
              loadingMore={list.isFetchingNextPage}
              onSelect={setChosen}
              onMore={() => void list.fetchNextPage().catch(() => undefined)}
            />
          )}
        </div>
        <div {...surfaceAttributes({ frame: "pane", edge: "inline-start" }, "inbox-detail")}>
          <ConversationView
            key={selectedId}
            client={client}
            threadId={selectedId}
            item={selectedItem}
            accountName={selectedItem ? names[selectedItem.accountId] : undefined}
          />
        </div>
      </div>
    </section>
  );
}
