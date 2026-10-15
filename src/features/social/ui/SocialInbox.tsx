import { SearchInput } from "../../../shared/ui/SearchInput";
import { useState } from "react";
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
              .toLocaleLowerCase("tr")
              .includes(query.trim().toLocaleLowerCase("tr")))),
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
                reason: error instanceof Error ? error.message : "Yenilenemedi.",
              };
            }
          }),
        );
        setSyncResults(results);
        if (!results.some((result) => result.success))
          throw new Error(
            "Hiçbir hesabın gelen kutusu yenilenemedi. Hesapların hata ayrıntılarını kontrol edin.",
          );
      }, "Gelen kutusu yenilendi. Hesapların sonuçlarını kontrol edin.");
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="social-page">
      <p className="social-page-intro">
        Mesaj ve yorumları seçin, tek tek veya toplu yanıt hazırlayın.
      </p>
      <div className="social-columns">
        <section>
          <h2>
            Gelen kutusu <small>{threads.length}</small>
          </h2>
          <label>
            Konuşma ara
            <SearchInput
              standalone
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Kişi veya ileti"
            />
          </label>
          <label>
            Hesap
            <select
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
            >
              <option value="">Tüm hesaplar</option>
              {snapshot.accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            İleti türü
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="">Mesaj ve yorumlar</option>
              <option value="message">Mesajlar</option>
              <option value="comment">Yorumlar</option>
            </select>
          </label>
          <button
            disabled={!snapshot.hostOnline || !syncAccounts.length || syncing}
            onClick={() => void synchronize()}
          >
            <RefreshCw aria-hidden="true" />
            {syncing ? "Yenileniyor…" : "Konuşmaları yenile"}
          </button>
          {unsupportedAccounts.map((item) => (
            <Notice
              key={item.id}
              kind="warning"
              title={`${item.name} · Gelen kutusu kullanılamıyor`}
            >
              {item.connection === "browser"
                ? "X tarayıcı bağlantısı paylaşım yapabilir; mesajları ve gelen yorumları okuyamaz. Bu işlemler için resmî API hesabı bağlayın."
                : !item.connected || item.paused
                  ? "Hesap bağlantısını Hesaplar bölümünden kontrol edin."
                  : snapshot.capabilities[item.id]?.find(
                      (capability) => capability.operation === "poll",
                    )?.reason ||
                    "Bu hesabın gelen kutusu okuma erişimi yok. Hesap erişimini kontrol edin."}
            </Notice>
          ))}
          {syncResults.map((result) => (
            <Notice
              key={result.account}
              kind={result.success ? "success" : "error"}
              title={result.account}
            >
              {result.success ? "Güncel iletiler alındı." : result.reason}
            </Notice>
          ))}
          <label className="social-select-all">
            <input
              type="checkbox"
              aria-label="Görünen tüm konuşmaları seç"
              checked={threads.length > 0 && threads.every((item) => checkedIds.includes(item.id))}
              disabled={!threads.length}
              onChange={(event) =>
                setCheckedIds(event.target.checked ? threads.map((item) => item.id) : [])
              }
            />
            Görünen tüm konuşmaları seç ({threads.length})
          </label>
          <div className="social-bulk-toolbar">
            <span>{checkedThreads.length} konuşma seçili</span>
            <button disabled={!checkedIds.length} onClick={() => setCheckedIds([])}>
              Seçimi temizle
            </button>
          </div>
          <Composer title="Seçili konuşmalara yanıt hazırla">
            <SocialBulkComposer
              client={client}
              snapshot={snapshot}
              projects={projects}
              run={run}
              targets={checkedThreads.map(threadTarget)}
              replyOnly
            />
          </Composer>
          <div className="social-list">
            {threads.length ? (
              threads.map((item) => (
                <div className="social-selection-row" key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`${contacts.get(item.contactId)?.name ?? "Kişi"} konuşmasını seç`}
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
                  <button
                    className="social-row"
                    aria-pressed={selected === item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <strong>{contacts.get(item.contactId)?.name ?? "Kişi"}</strong>
                    <span>
                      {item.kind === "message" ? "Mesaj" : "Yorum"} ·{" "}
                      {snapshot.accounts.find((account) => account.id === item.accountId)?.name}
                    </span>
                    <p>{item.events[item.events.length - 1]?.text.slice(0, 140)}</p>
                    <span>{time(item.lastInboundAt)}</span>
                    {item.reviewReason || !item.projectId ? (
                      <StatusBadge status="review" label="Proje seçilmeli" />
                    ) : null}
                  </button>
                </div>
              ))
            ) : (
              <Empty
                title={
                  snapshot.threads.length
                    ? "Konuşma bulunamadı"
                    : unsupportedAccounts.length === visibleAccounts.length &&
                        visibleAccounts.length
                      ? "Gelen kutusu erişimi gerekli"
                      : "Henüz ileti yok"
                }
                icon={InboxIcon}
              >
                {snapshot.threads.length
                  ? "Aramayı veya filtreleri değiştirin."
                  : syncAccounts.length
                    ? "Konuşmaları yenile düğmesiyle yeni mesaj ve yorumları alın."
                    : "Hesaplar bölümünden gelen kutusu erişimi olan bir hesap bağlayın."}
              </Empty>
            )}
          </div>
        </section>
        <section>
          {thread ? (
            <>
              <h2>{contacts.get(thread.contactId)?.name ?? "Konuşma"}</h2>
              <p className="social-muted">
                {thread.kind === "message" ? "Özel mesaj" : "Yorum"} · {account?.name} ·{" "}
                {account ? names[account.platform] : ""}
                {thread.replyUntil ? ` · Son yanıt zamanı ${time(thread.replyUntil)}` : ""}
              </p>
              {thread.reviewReason ? (
                <Notice kind="warning" title="Proje eşleşmesini kontrol edin">
                  {thread.reviewReason}
                </Notice>
              ) : null}
              {thread.replyAllowed === false ? (
                <Notice kind="warning">
                  Platform bu konuşmaya yanıt gönderilmesine izin vermiyor.
                </Notice>
              ) : null}
              <label>
                İlgili proje
                <select
                  value={thread.projectId ?? ""}
                  onChange={(event) =>
                    void run(
                      () =>
                        client.request("thread.assign", {
                          id: thread.id,
                          projectId: event.target.value,
                        }),
                      "Konuşmanın projesi güncellendi.",
                    )
                  }
                >
                  <option value="" disabled>
                    Proje seçin
                  </option>
                  {projects
                    .filter((project) => account?.grants[project.id]?.includes("draft"))
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name || project.cwd}
                      </option>
                    ))}
                </select>
              </label>
              <div className="social-conversation">
                {detail.loading ? (
                  <Notice kind="loading" title="Konuşma geçmişi yükleniyor" />
                ) : null}
                {detail.error ? <Notice kind="error">{detail.error}</Notice> : null}
                {(!summary?.eventsPreview || detail.value ? thread.events : []).map((event) => (
                  <article
                    key={event.id}
                    className={event.direction === "outbound" ? "social-outbound" : ""}
                  >
                    <small>
                      {event.direction === "inbound" ? "Gelen" : "Gönderilen"} · {time(event.at)}
                    </small>
                    <p className="social-message">{event.text}</p>
                  </article>
                ))}
              </div>
              <HistoryPageControls
                page={detail.value?.eventsPage}
                loading={detail.loading}
                label="Konuşma geçmişi sayfaları"
                onPage={detail.show}
              />
              <Composer title="Yanıt hazırla">
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
              {currentDrafts.length ? (
                <>
                  <h3>Yanıt taslakları ({currentDrafts.length})</h3>
                  <DraftList drafts={currentDrafts} client={client} run={run} snapshot={snapshot} />
                </>
              ) : null}
              <JobList snapshot={snapshot} client={client} run={run} thread={thread} />
            </>
          ) : (
            <Empty title="Bir konuşma seçin" icon={InboxIcon}>
              İletileri okuyun veya listeden birden fazla konuşmayı seçip toplu yanıt hazırlayın.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}
