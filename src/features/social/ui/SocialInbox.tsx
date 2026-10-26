import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { SocialFilters } from "./SocialFilters";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { NativeSelect } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
import { Progress } from "../../../shared/ui/Progress";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useState } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { socialRows } from "../model/socialWorkspace";
import type { SocialThread } from "../model/social";
import { HistoryPageControls, useSocialHistoryPage } from "./SocialHistoryPage";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import { Inbox as InboxIcon, RefreshCw } from "../../../shared/ui/icons";
import { DraftList } from "./SocialDrafts";
import { JobList } from "./SocialManagement";
import { SocialBulkComposer } from "./SocialBulkComposer";
import { threadTarget } from "./socialBulk";
import { Composer, Empty, Notice, StatusBadge, names, time, type Props } from "./socialShared";

export function Inbox({ client, snapshot, projects, run, onFilterChange }: Props) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(snapshot.threads[0]?.id ?? "");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, { text: string; factIds: string[] }>>({});
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const hostFiltered = useSocialWorkspaceFilter(
    snapshot,
    "threads",
    {
      query: query.trim(),
      accountId: accountFilter,
      kind: kindFilter,
    },
    onFilterChange,
  );
  const [syncResults, setSyncResults] = useState<
    { account: string; success: boolean; reason?: string }[]
  >([]);
  const [syncing, setSyncing] = useState(false);
  const summary = snapshot.threads.find((item) => item.id === selected);
  const detail = useSocialHistoryPage<SocialThread>(
    client,
    "thread.page",
    summary?.id,
    `${summary?.projectId}:${summary?.eventsPage?.total}:${summary?.events[summary.events.length - 1]?.id}:${summary?.replyUntil}:${summary?.reviewReason}`,
    !!summary?.eventsPreview,
  );
  const thread = detail.value ?? summary;
  const account = snapshot.accounts.find((item) => item.id === thread?.accountId);
  const contacts = new Map(
    socialRows(snapshot.contacts, snapshot.related?.contacts).map((contact) => [
      contact.id,
      contact,
    ]),
  );
  const threads = snapshot.threads
    .filter(
      (item) =>
        hostFiltered ||
        ((!accountFilter || item.accountId === accountFilter) &&
          (!kindFilter || item.kind === kindFilter) &&
          (!query.trim() ||
            `${contacts.get(item.contactId)?.name ?? ""} ${item.events[item.events.length - 1]?.text ?? ""}`
              .toLocaleLowerCase(getLocale())
              .includes(query.trim().toLocaleLowerCase(getLocale())))),
    )
    .sort((a, b) => b.lastInboundAt - a.lastInboundAt);
  const visibleAccounts = snapshot.accounts.filter(
    (item) => !accountFilter || item.id === accountFilter,
  );
  const syncAccounts = visibleAccounts.filter(
    (item) =>
      item.connected &&
      !item.paused &&
      snapshot.capabilities[item.id]?.some(
        (capability) => capability.operation === "poll" && capability.status === "available",
      ),
  );
  const unsupportedAccounts = visibleAccounts.filter(
    (item) => !syncAccounts.some((sync) => sync.id === item.id),
  );
  const checkedThreads = threads.filter((item) => checkedIds.includes(item.id));
  const currentDrafts = snapshot.drafts.filter((draft) => draft.threadId === thread?.id);
  const synchronize = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResults([]);
    try {
      await run(async () => {
        const results = await Promise.all(
          syncAccounts.map(async (item) => {
            try {
              await client.request("inbox.sync", { accountId: item.id });
              return { account: item.name, success: true };
            } catch (error) {
              return {
                account: item.name,
                success: false,
                reason: error instanceof Error ? error.message : t("Could not refresh."),
              };
            }
          }),
        );
        setSyncResults(results);
        if (!results.some((result) => result.success))
          throw new Error(
            t("No account's inbox could be refreshed. Check the accounts' error details."),
          );
      }, t("Inbox refreshed. Check each account's result."));
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="social-page social-collection-page">
      <div
        className="social-columns social-collection-workspace"
        data-empty={!snapshot.threads.length}
      >
        <section className="social-collection-list">
          <h2>
            {t("Inbox")} <small>{threads.length}</small>
          </h2>
          <div className="social-list-tools">
            <label>
              {t("Find a conversation")}
              <SearchInput
                disabled={socialLocked}
                appearance="field"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Contact or message")}
              />
            </label>
            <SocialFilters
              activeCount={Number(!!accountFilter) + Number(!!kindFilter)}
              onReset={() => {
                setAccountFilter("");
                setKindFilter("");
              }}
            >
              <label>
                {t("Account")}
                <SearchableSelect
                  disabled={socialLocked}
                  value={accountFilter}
                  label={t("Account")}
                  options={[
                    { value: "", label: t("All accounts") },
                    ...snapshot.accounts.map((item) => ({
                      value: item.id,
                      label: item.name,
                    })),
                  ]}
                  onChange={(nextValue) => setAccountFilter(nextValue)}
                  searchLocale={getLocale()}
                />
              </label>
              <label>
                {t("Message type")}
                <NativeSelect
                  disabled={socialLocked}
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.target.value)}
                >
                  <option value="">{t("Messages and comments")}</option>
                  <option value="message">{t("Messages")}</option>
                  <option value="comment">{t("Comments")}</option>
                </NativeSelect>
              </label>
            </SocialFilters>
            <Button
              disabled={socialLocked}
              type="button"
              variant={selecting ? "secondary" : "ghost"}
              aria-pressed={selecting}
              hidden={!threads.length}
              onClick={() => {
                if (selecting) setCheckedIds([]);
                setSelecting(!selecting);
              }}
            >
              {selecting ? t("Finish selecting") : t("Select")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              iconOnly
              label={syncing ? t("Refreshing…") : t("Refresh conversations")}
              loading={pendingUi.is("inbox.refresh")}
              disabled={socialLocked || !snapshot.hostOnline || !syncAccounts.length || syncing}
              onClick={() => void pendingUi.run("inbox.refresh", () => synchronize())}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
          {unsupportedAccounts.length ? (
            <details className="social-settings">
              <summary>
                {t("{p0} accounts have no inbox access", { p0: unsupportedAccounts.length })}
              </summary>
              {unsupportedAccounts.map((item) => (
                <Notice
                  key={item.id}
                  kind="warning"
                  title={t("{p0} · Inbox unavailable", { p0: item.name })}
                >
                  {!item.connected || item.paused
                    ? t("Check the account connection in the Accounts section.")
                    : snapshot.capabilities[item.id]?.find(
                        (capability) => capability.operation === "poll",
                      )?.reason ||
                      t(
                        "This account has no permission to read its inbox. Check the account's access.",
                      )}
                </Notice>
              ))}
            </details>
          ) : null}
          {syncResults.some((result) => !result.success) ? (
            <>
              {syncResults.some((result) => result.success) ? (
                <p className="social-muted" role="status">
                  {t("Refreshed: {p0}", {
                    p0: syncResults
                      .filter((result) => result.success)
                      .map((result) => result.account)
                      .join(", "),
                  })}
                </p>
              ) : null}
              {syncResults
                .filter((result) => !result.success)
                .map((result) => (
                  <Notice key={result.account} kind="error" title={result.account}>
                    {result.reason}
                  </Notice>
                ))}
            </>
          ) : null}
          {selecting ? (
            <label className="social-select-all" hidden={!threads.length}>
              <Checkbox
                aria-label={t("Select all visible conversations")}
                checked={
                  threads.length > 0 && threads.every((item) => checkedIds.includes(item.id))
                }
                disabled={socialLocked || !threads.length}
                onChange={(event) =>
                  setCheckedIds(event.target.checked ? threads.map((item) => item.id) : [])
                }
              />
              {t("Select all visible conversations ({p0})", { p0: threads.length })}
            </label>
          ) : null}
          <div hidden={!checkedThreads.length}>
            <div className="social-bulk-toolbar">
              <span>{t("{p0} conversations selected", { p0: checkedThreads.length })}</span>
              <Button
                type="button"
                variant="ghost"
                disabled={socialLocked || !checkedIds.length}
                onClick={() => setCheckedIds([])}
              >
                {t("Clear selection")}
              </Button>
            </div>
            <Composer title={t("Prepare replies to selected conversations")}>
              <SocialBulkComposer
                client={client}
                snapshot={snapshot}
                projects={projects}
                run={run}
                targets={checkedThreads.map(threadTarget)}
                replyOnly
              />
            </Composer>
          </div>
          <div className="social-list">
            {threads.length ? (
              threads.map((item) => (
                <div className="social-selection-row" key={item.id}>
                  {selecting || checkedIds.length ? (
                    <label>
                      <Checkbox
                        disabled={socialLocked}
                        aria-label={t("Select conversation with {p0}", {
                          p0: contacts.get(item.contactId)?.name ?? t("Contact person"),
                        })}
                        checked={checkedIds.includes(item.id)}
                        onChange={(event) =>
                          setCheckedIds((current) =>
                            event.target.checked
                              ? [...current, item.id]
                              : current.filter((id) => id !== item.id),
                          )
                        }
                      />
                    </label>
                  ) : null}
                  <Button
                    disabled={socialLocked}
                    type="button"
                    variant="tab"
                    layout="stacked"
                    className="social-row"
                    aria-pressed={selected === item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="social-row-head">
                      <strong>{contacts.get(item.contactId)?.name ?? t("Contact person")}</strong>
                      <small>{time(item.lastInboundAt)}</small>
                    </span>
                    <p className="social-row-preview">
                      {item.events[item.events.length - 1]?.text.slice(0, 140)}
                    </p>
                    <span className="social-row-meta">
                      {item.kind === "message" ? t("Message") : t("Comment")} ·{" "}
                      {snapshot.accounts.find((account) => account.id === item.accountId)?.name}
                    </span>
                    {item.reviewReason || !item.projectId ? (
                      <StatusBadge status="review" label={t("Project required")} />
                    ) : null}
                  </Button>
                </div>
              ))
            ) : (
              <Empty
                title={
                  snapshot.threads.length
                    ? t("No conversations found")
                    : unsupportedAccounts.length === visibleAccounts.length &&
                        visibleAccounts.length
                      ? t("Inbox access required")
                      : t("No messages yet")
                }
                icon={InboxIcon}
              >
                {snapshot.threads.length
                  ? t("Change the search or filters.")
                  : syncAccounts.length
                    ? t("Use the refresh button to fetch new messages and comments.")
                    : t("Connect an account with inbox access in the Accounts section.")}
              </Empty>
            )}
          </div>
        </section>
        <section className="social-collection-detail" hidden={!snapshot.threads.length}>
          {thread ? (
            <>
              <div className="social-detail-header">
                <h2>{contacts.get(thread.contactId)?.name ?? t("Conversation")}</h2>
                <Composer title={t("Prepare reply")}>
                  <SocialBulkComposer
                    key={thread.id}
                    client={client}
                    snapshot={snapshot}
                    projects={projects}
                    run={run}
                    targets={[threadTarget(thread)]}
                    replyOnly
                    content={answers[thread.id] ?? { text: "", factIds: [] }}
                    onContentChange={(content) =>
                      setAnswers((current) => ({ ...current, [thread.id]: content }))
                    }
                  />
                </Composer>
              </div>
              <p className="social-muted">
                {thread.kind === "message" ? t("Direct message") : t("Comment")} · {account?.name} ·{" "}
                {account ? names[account.platform] : ""}
                {account?.connection !== "browser" && thread.replyUntil
                  ? ` · ${t("Reply deadline {p0}", { p0: time(thread.replyUntil) })}`
                  : ""}
              </p>
              {thread.reviewReason ? (
                <Notice kind="warning" title={t("Check the project match")}>
                  {thread.reviewReason}
                </Notice>
              ) : null}
              {thread.replyAllowed === false ? (
                <Notice kind="warning">
                  {t("The platform does not allow sending replies to this conversation.")}
                </Notice>
              ) : null}
              <label>
                {t("Related project")}
                <SearchableSelect
                  disabled={socialLocked || pendingUi.is(`thread.assign:${thread.id}`)}
                  value={thread.projectId ?? ""}
                  label={t("Related project")}
                  options={[
                    { value: "", label: t("Select a project"), disabled: true },
                    ...projects
                      .filter((project) => account?.grants[project.id]?.includes("draft"))
                      .map((project) => ({
                        value: project.id,
                        label: project.name || project.cwd,
                      })),
                  ]}
                  onChange={(nextValue) =>
                    void pendingUi.run(`thread.assign:${thread.id}`, () =>
                      run(
                        () =>
                          client.request("thread.assign", {
                            id: thread.id,
                            projectId: nextValue,
                          }),
                        t("Conversation project updated."),
                      ),
                    )
                  }
                  searchLocale={getLocale()}
                />
                {pendingUi.is(`thread.assign:${thread.id}`) ? (
                  <Progress compact label={t("Working…")} />
                ) : null}
              </label>
              <div className="social-conversation">
                {detail.loading ? (
                  <Notice kind="loading" title={t("Loading conversation history")} />
                ) : null}
                {detail.error ? <Notice kind="error">{detail.error}</Notice> : null}
                {(!summary?.eventsPreview || detail.value ? thread.events : []).map((event) => (
                  <article
                    key={event.id}
                    className={event.direction === "outbound" ? "social-outbound" : ""}
                  >
                    <small>
                      {event.direction === "inbound" ? t("Incoming") : t("Outgoing")} ·{" "}
                      {time(event.at)}
                    </small>
                    <p className="social-message">{event.text}</p>
                  </article>
                ))}
              </div>
              <HistoryPageControls
                page={detail.value?.eventsPage}
                loading={detail.loading}
                label={t("Conversation history pages")}
                onPage={detail.show}
              />

              {currentDrafts.length ? (
                <>
                  <h3>{t("Reply drafts ({p0})", { p0: currentDrafts.length })}</h3>
                  <DraftList drafts={currentDrafts} client={client} run={run} snapshot={snapshot} />
                </>
              ) : null}
              <details
                className="social-settings social-thread-history"
                open={snapshot.jobs.some((job) =>
                  snapshot.drafts.some(
                    (draft) => draft.id === job.draftId && draft.threadId === thread.id,
                  ),
                )}
              >
                <summary>{t("Send history")}</summary>
                <JobList snapshot={snapshot} client={client} run={run} thread={thread} />
              </details>
            </>
          ) : (
            <Empty
              title={
                snapshot.threads.length
                  ? t("Select a conversation")
                  : syncAccounts.length
                    ? t("Your messages and comments appear here")
                    : t("Connect an inbox")
              }
              icon={InboxIcon}
            >
              {snapshot.threads.length
                ? t("Read the message, prepare a reply with AI and review it before sending.")
                : syncAccounts.length
                  ? t("Refresh conversations to fetch new messages.")
                  : t(
                      "Connect an account with message and comment read access in the Accounts section.",
                    )}
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}
