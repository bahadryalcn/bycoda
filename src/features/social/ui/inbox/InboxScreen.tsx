import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Switch } from "../../../../shared/ui/Switch";
import { EmptyHint } from "../common/EmptyHint";
import type { SocialScreenProps } from "../shell/screens";
import { inboxApi } from "./inboxApi";
import { InboxFilters } from "./InboxFilters";
import { InboxList } from "./InboxList";
import { UnreadableNotice } from "./InboxNotices";
import { ConversationView } from "./ConversationView";
import type { InboxFilterState } from "./inboxTypes";
import { useInboxInvalidate, useInboxList, useInboxSnapshot } from "./useInboxData";
import "./inbox.css";

const NO_FILTER: InboxFilterState = { status: "all", accountId: "", query: "" };

/** A thread id passed in by navigation (for example from a notification or the shell). */
function targetThreadId(target: unknown): string | undefined {
  if (!target || typeof target !== "object" || !("threadId" in target)) return undefined;
  return typeof target.threadId === "string" ? target.threadId : undefined;
}

/** Unified inbox: filters, one list of comments and messages, the selected conversation and a reply box. */
export function InboxScreen({ client, active, target }: SocialScreenProps) {
  useLocale();
  const api = inboxApi(client);
  const invalidate = useInboxInvalidate(client);
  const snapshot = useInboxSnapshot(client);
  const [filter, setFilter] = useState<InboxFilterState>(NO_FILTER);
  const [chosen, setChosen] = useState<string | undefined>(() => targetThreadId(target));
  const [settingsError, setSettingsError] = useState("");
  const [checking, setChecking] = useState(false);

  const autoRefresh = snapshot.data?.pollingEnabled;
  const list = useInboxList(client, filter, {
    enabled: active,
    refresh: active && autoRefresh === true,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unreadable = list.data?.pages[0]?.unreadable ?? [];
  const accounts = snapshot.data?.accounts ?? [];
  const names = Object.fromEntries(accounts.map((account) => [account.id, account.name]));
  const accountOptions = accounts.map((account) => ({ value: account.id, label: account.name }));
  const selectedId = chosen ?? items[0]?.threadId;
  const selectedItem = items.find((item) => item.threadId === selectedId);
  const filtered = filter.status !== "all" || filter.accountId !== "" || filter.query.trim() !== "";

  const toggleAutoRefresh = async (next: boolean) => {
    setSettingsError("");
    try {
      await api.setAutoRefresh(next);
      await invalidate();
    } catch {
      setSettingsError(t("Could not change auto-refresh. Try again."));
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
      await invalidate();
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="inbox-screen" aria-label={t("Inbox")}>
      {settingsError ? <InlineError>{settingsError}</InlineError> : null}
      <UnreadableNotice accounts={unreadable} names={names} />
      <InboxFilters value={filter} accounts={accountOptions} onChange={setFilter}>
        <div className="inbox-refresh">
          <span>{t("Auto-refresh")}</span>
          <Switch
            aria-label={t("Auto-refresh")}
            compact
            checked={autoRefresh === true}
            disabled={autoRefresh === undefined}
            onCheckedChange={(next) => void toggleAutoRefresh(next).catch(() => undefined)}
          />
        </div>
      </InboxFilters>

      {list.isError ? <InlineError>{t("Could not load the inbox. Try again.")}</InlineError> : null}

      <div className="inbox-body">
        <div className="inbox-column">
          {!list.isPending && items.length === 0 ? (
            <EmptyHint
              message={
                filtered
                  ? t("No conversations match these filters.")
                  : t("No conversations yet. New messages and comments appear here.")
              }
              action={
                filtered
                  ? undefined
                  : {
                      label: checking ? t("Checking…") : t("Check now"),
                      disabled: false,
                      onClick: () =>
                        void checkNow().catch(() =>
                          setSettingsError(t("Could not load the inbox. Try again.")),
                        ),
                    }
              }
            />
          ) : (
            <InboxList
              items={items}
              selectedId={selectedId}
              loading={list.isPending}
              hasMore={list.hasNextPage}
              loadingMore={list.isFetchingNextPage}
              onSelect={setChosen}
              onMore={() => void list.fetchNextPage().catch(() => undefined)}
            />
          )}
        </div>
        <div className="inbox-detail">
          <ConversationView
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
