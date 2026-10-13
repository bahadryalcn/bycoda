import { useContext, useEffect, useState } from "react";
import type { SocialContact, SocialPage } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { Empty, Notice, time } from "./socialShared";
import { SocialPanelActiveContext } from "./socialContext";

/** Selected detail only. Identity/version/offset guard late responses, including
 * a switch to another thread, contact or host while a page is still in flight. */
export function useSocialHistoryPage<T extends { id: string }>(
  client: SocialClient,
  action: "thread.page" | "contacts.history",
  id: string | undefined,
  version: string,
  enabled: boolean,
) {
  const active = useContext(SocialPanelActiveContext);
  const [offsets, setOffsets] = useState<Record<string, number | undefined>>({});
  const offset = id ? offsets[id] : undefined;
  const stamp = `${id}:${version}:${offset ?? "latest"}`;
  const [result, setResult] = useState<{ stamp: string; value?: T; error?: string }>();
  useEffect(() => {
    if (!enabled || !id || !active) return;
    let alive = true;
    setResult(undefined);
    void client
      .request<T>(action, { id, limit: 20, ...(offset === undefined ? {} : { offset }) })
      .then((value) => {
        if (value?.id !== id) throw new Error("Geçmiş yanıtı bu kayıtla eşleşmiyor.");
        if (alive) setResult({ stamp, value });
      })
      .catch((error) => alive && setResult({ stamp, error: String(error) }));
    return () => {
      alive = false;
    };
  }, [client, action, id, stamp, offset, enabled, active]);
  const current = result?.stamp === stamp ? result : undefined;
  return {
    value: current?.value,
    error: current?.error,
    loading: enabled && !current,
    show: (nextOffset: number | undefined) =>
      id && setOffsets((previous) => ({ ...previous, [id]: nextOffset })),
  };
}

export function HistoryPageControls({
  page,
  loading,
  label,
  onPage,
}: {
  page?: SocialPage;
  loading: boolean;
  label: string;
  onPage: (offset: number) => void;
}) {
  if (!page || !page.total) return null;
  return (
    <nav aria-label={label} className="social-filter-tabs">
      <span>
        {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} / {page.total}
      </span>
      <button
        type="button"
        disabled={loading || !page.offset}
        onClick={() => onPage(Math.max(0, page.offset - page.limit))}
      >
        Önceki kayıtlar
      </button>
      <button
        type="button"
        disabled={loading || page.offset + page.limit >= page.total}
        onClick={() => onPage(page.offset + page.limit)}
      >
        Sonraki kayıtlar
      </button>
    </nav>
  );
}

export function SocialContactHistory({
  contact,
  client,
}: {
  contact: SocialContact;
  client: SocialClient;
}) {
  const last = contact.history[contact.history.length - 1];
  const detail = useSocialHistoryPage<SocialContact>(
    client,
    "contacts.history",
    contact.id,
    `${contact.historyPage?.total}:${last?.operationId}:${last?.at}`,
    !!contact.historyPage,
  );
  const history = contact.historyPage ? (detail.value?.history ?? []) : contact.history;
  return (
    <>
      {detail.loading ? <Notice kind="loading" title="Etkileşim geçmişi yükleniyor" /> : null}
      {detail.error ? <Notice kind="error">{detail.error}</Notice> : null}
      <HistoryPageControls
        page={detail.value?.historyPage}
        loading={detail.loading}
        label="Kişi etkileşim geçmişi sayfaları"
        onPage={detail.show}
      />
      {history.length ? (
        <table>
          <thead>
            <tr>
              <th>Etkileşim</th>
              <th>Tarih</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item, index) => (
              <tr key={`${item.operationId}:${index}`}>
                <td>{item.kind}</td>
                <td>{time(item.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !detail.loading && !detail.error ? (
        <Empty>Bu kişiyle kayıtlı etkileşim yok.</Empty>
      ) : null}
    </>
  );
}
