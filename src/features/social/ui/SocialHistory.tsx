import { SearchInput } from "../../../shared/ui/SearchInput";
import { useState } from "react";
import { socialRows } from "../model/socialWorkspace";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import type { SocialJob, SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import {
  Empty,
  Notice,
  StatusBadge,
  names,
  statuses,
  time,
  type Props,
  type Run,
} from "./socialShared";

const jobKinds: Record<SocialJob["kind"], string> = {
  publish: "Paylaşım",
  reply: "Yanıt",
  message: "Mesaj",
  comment: "Yorum",
};
const PAGE_SIZE = 30;
export function socialJobExplanation(job: SocialJob): string {
  if (job.status === "cancelled") return "Bu iş iptal edildi; gönderim beklemiyor.";
  if (job.status === "review")
    return "Sonuç doğrulanamadı. Hesabı kontrol edin; aynı içeriği yeniden göndermeyin.";
  if (job.status === "failed")
    return "Gönderim başarısız. Ayrıntıyı kontrol edip bu hedefi yeniden deneyebilirsiniz.";
  if (job.status === "queued") return `Planlanan gönderim: ${time(job.scheduledAt)}`;
  if (job.status === "running") return "Platformdan sonuç bekleniyor.";
  return "Platform gönderimi doğruladı.";
}
function resultUrl(value?: string) {
  try {
    const parsed = new URL(value ?? "");
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function SocialHistory({ snapshot, client, run, onFilterChange }: Props) {
  const waiting = snapshot.jobCounts
    ? (snapshot.jobCounts.queued ?? 0) + (snapshot.jobCounts.running ?? 0)
    : snapshot.jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const attention = snapshot.jobCounts
    ? (snapshot.jobCounts.failed ?? 0) + (snapshot.jobCounts.review ?? 0)
    : snapshot.jobs.filter((job) => job.status === "failed" || job.status === "review").length;
  return (
    <div className="social-history-page">
      <div className="social-section-heading">
        <div>
          <h2>İşlem geçmişi ve kuyruk</h2>
          <p className="social-muted">Planlanan gönderimler ve tamamlanan işlem sonuçları.</p>
        </div>
      </div>
      <div className="social-stats social-history-summary" aria-label="Gönderim özeti">
        <div>
          <strong>
            {snapshot.jobCounts?.succeeded ??
              snapshot.jobs.filter((job) => job.status === "succeeded").length}
          </strong>
          <span>{statuses.succeeded}</span>
        </div>
        <div>
          <strong>{waiting}</strong>
          <span>Bekleyen</span>
        </div>
        <div>
          <strong>{attention}</strong>
          <span>Kontrol gerekli</span>
        </div>
        <div>
          <strong>
            {snapshot.jobCounts?.cancelled ??
              snapshot.jobs.filter((job) => job.status === "cancelled").length}
          </strong>
          <span>{statuses.cancelled}</span>
        </div>
      </div>
      {!snapshot.sendingEnabled || snapshot.stopped || !snapshot.hostOnline ? (
        <Notice
          kind="warning"
          title={
            snapshot.stopped
              ? "Gönderimler durduruldu"
              : !snapshot.hostOnline
                ? "Gönderim hizmeti kapalı"
                : "Gönderim kapalı"
          }
        >
          Kuyruktaki işler korunuyor. Gönderim kontrollerini Otomasyonlar bölümünden yönetin.
        </Notice>
      ) : null}
      <JobHistory snapshot={snapshot} client={client} run={run} onFilterChange={onFilterChange} />
    </div>
  );
}

export function JobHistory({
  snapshot,
  client,
  run,
  jobs = snapshot.jobs,
  onFilterChange,
}: {
  snapshot: SocialSnapshot;
  client: SocialClient;
  run: Run;
  jobs?: SocialJob[];
  onFilterChange?: Props["onFilterChange"];
}) {
  const campaigns = socialRows(snapshot.campaigns, snapshot.related?.campaigns);
  const contacts = socialRows(snapshot.contacts, snapshot.related?.contacts);
  const [status, setStatus] = useState("");
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [since, setSince] = useState("");
  const hostFiltered = useSocialWorkspaceFilter(
    snapshot,
    "jobs",
    {
      query,
      status,
      accountId,
      kind,
      ...(since ? { since: new Date(`${since}T00:00:00`).getTime() } : {}),
    },
    onFilterChange,
  );
  const filtered = jobs
    .filter((job) => {
      if (hostFiltered && onFilterChange) return true;
      const account = snapshot.accounts.find((item) => item.id === job.accountId);
      const campaign = campaigns.find((item) => item.id === job.campaignId);
      const contact = contacts.find((item) => item.id === job.contactId);
      return (
        (!status || job.status === status) &&
        (!accountId || job.accountId === accountId) &&
        (!kind || job.kind === kind) &&
        (!since || job.createdAt >= new Date(`${since}T00:00:00`).getTime()) &&
        `${account?.name ?? ""} ${campaign?.name ?? ""} ${contact?.name ?? ""} ${job.payload.text} ${job.error ?? ""}`
          .toLocaleLowerCase("tr")
          .includes(query.toLocaleLowerCase("tr"))
      );
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.scheduledAt - a.scheduledAt);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const reset = () => {
    setQuery("");
    setStatus("");
    setAccountId("");
    setKind("");
    setSince("");
    setPage(0);
  };
  return (
    <div className="social-job-list">
      <div className="social-toolbar social-history-filters">
        <label>
          İşlem ara
          <SearchInput
            standalone
            type="search"
            value={query}
            placeholder="İçerik, kişi veya kampanya"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Gönderim durumu
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">
              Tüm işler ·{" "}
              {onFilterChange && snapshot.jobCounts
                ? Object.values(snapshot.jobCounts).reduce(
                    (total, count) => total + (count ?? 0),
                    0,
                  )
                : jobs.length}
            </option>
            {["queued", "running", "succeeded", "failed", "review", "cancelled"].map((item) => (
              <option key={item} value={item}>
                {statuses[item]} ·{" "}
                {(onFilterChange ? snapshot.jobCounts?.[item as SocialJob["status"]] : undefined) ??
                  jobs.filter((job) => job.status === item).length}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hesap
          <select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Tüm hesaplar</option>
            {snapshot.accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {names[item.platform]}
              </option>
            ))}
          </select>
        </label>
        <label>
          İşlem türü
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Tüm işlemler</option>
            {Object.entries(jobKinds).map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Başlangıç tarihi
          <input
            type="date"
            value={since}
            onChange={(event) => {
              setSince(event.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <p className="social-inline-meta" role="status">
        {hostFiltered && onFilterChange ? snapshot.pages?.jobs?.total : filtered.length} iş
        {!hostFiltered && filtered.length !== jobs.length ? ` / ${jobs.length}` : ""}
        {status || accountId || kind || query || since ? (
          <button type="button" onClick={reset}>
            Filtreleri temizle
          </button>
        ) : null}
      </p>
      {filtered.length ? (
        <div className="social-history-records">
          {(onFilterChange && snapshot.pages
            ? filtered
            : filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
          ).map((job) => {
            const account = snapshot.accounts.find((item) => item.id === job.accountId);
            const campaign = campaigns.find((item) => item.id === job.campaignId);
            const contact = contacts.find((item) => item.id === job.contactId);
            const link = resultUrl(job.url);
            return (
              <article key={job.id} className="social-history-record" data-status={job.status}>
                <div className="social-record-heading">
                  <div>
                    <strong>
                      {jobKinds[job.kind]} · {campaign?.name ?? contact?.name ?? "Konuşma"}
                    </strong>
                    <p className="social-inline-meta">
                      {account?.name ?? "Hesap kaldırılmış"}
                      {account ? ` · ${names[account.platform]}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
                <p className="social-job-explanation">{socialJobExplanation(job)}</p>
                <p className="social-history-excerpt">{job.payload.text}</p>
                <div className="social-inline-meta">
                  <span>Oluşturuldu {time(job.createdAt)}</span>
                  {job.dispatchedAt ? <span>Gönderim başladı {time(job.dispatchedAt)}</span> : null}
                  {job.attempts ? <span>{job.attempts} deneme</span> : null}
                </div>
                {job.error && job.status !== "cancelled" ? (
                  <details className="social-job-error">
                    <summary>Sonuç ayrıntısı</summary>
                    <p>{job.error}</p>
                  </details>
                ) : null}
                {job.visibility ? (
                  <p className="social-muted">
                    Video:{" "}
                    {job.visibility === "public"
                      ? "Herkese açık"
                      : job.visibility === "private"
                        ? "Özel"
                        : "Liste dışı"}
                  </p>
                ) : null}
                <div className="social-actions">
                  {link ? (
                    <a className="social-result-link" href={link} target="_blank" rel="noreferrer">
                      Platformda aç
                    </a>
                  ) : null}
                  {job.status === "queued" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          () => client.request("jobs.cancel", { id: job.id }),
                          "Kuyruktaki iş iptal edildi.",
                        )
                      }
                    >
                      İşi iptal et
                    </button>
                  ) : null}
                  {job.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          () => client.request("jobs.retry", { id: job.id }),
                          "Başarısız hedef yeniden kuyruğa alındı.",
                        )
                      }
                    >
                      Bu hedefi yeniden dene
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title={jobs.length ? "Bu filtrelere uyan iş yok" : "Henüz gönderim yapılmadı"}>
          {jobs.length
            ? "Filtreleri temizleyerek diğer işleri görebilirsiniz."
            : "Planlanan paylaşımlar, mesajlar ve yanıtlar sonuçlarıyla burada görünecek."}
        </Empty>
      )}
      {!onFilterChange && filtered.length > PAGE_SIZE ? (
        <div className="social-pagination">
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Önceki
          </button>
          <span>
            {currentPage + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
          </span>
          <button
            type="button"
            disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Sonraki
          </button>
        </div>
      ) : null}
    </div>
  );
}
