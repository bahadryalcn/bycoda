import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
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
        if (value?.id !== id)
          throw new Error(t("The history response does not match this record."));
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
  useLocale();
  if (!page || !page.total || (page.total <= page.limit && !page.offset)) return null;
  return (
    <nav aria-label={label} className="social-filter-tabs">
      <span>
        {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} / {page.total}
      </span>
      <Button
        variant="secondary"
        loading={loading}
        type="button"
        disabled={loading || !page.offset}
        onClick={() => onPage(Math.max(0, page.offset - page.limit))}
      >
        {t("Previous records")}
      </Button>
      <Button
        variant="secondary"
        loading={loading}
        type="button"
        disabled={loading || page.offset + page.limit >= page.total}
        onClick={() => onPage(page.offset + page.limit)}
      >
        {t("Next records")}
      </Button>
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
  useLocale();
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
      {detail.loading ? <Notice kind="loading" title={t("Loading interaction history")} /> : null}
      {detail.error ? <Notice kind="error">{detail.error}</Notice> : null}
      <HistoryPageControls
        page={detail.value?.historyPage}
        loading={detail.loading}
        label={t("Contact interaction history pages")}
        onPage={detail.show}
      />
      {history.length ? (
        <table>
          <thead>
            <tr>
              <th>{t("Interaction")}</th>
              <th>{t("Date")}</th>
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
        <Empty>{t("No recorded interactions with this contact.")}</Empty>
      ) : null}
    </>
  );
}
