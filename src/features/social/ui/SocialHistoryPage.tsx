import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useContext, useEffect, useState } from "react";
import type { SocialContact, SocialPage } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { Empty, Notice, time } from "./socialShared";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SocialPanelActiveContext } from "./socialContext";

export function socialContactHistoryLabel(kind: string) {
  return (
    (
      {
        "inbound:message": t("Message received"),
        "inbound:comment": t("Comment received"),
        "inbound:reply": t("Reply received"),
        "inbound:mention": t("Mention received"),
        "outbound:message": t("Message dispatch accepted"),
        "outbound:comment": t("Comment dispatch accepted"),
        "outbound:reply": t("Reply dispatch accepted"),
        "outbound:publish": t("Post dispatch accepted"),
      } as Record<string, string>
    )[kind] ?? t("Recorded interaction")
  );
}

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
  const [revision, setRevision] = useState(0);
  const [offsets, setOffsets] = useState<Record<string, number | undefined>>({});
  const offset = id ? offsets[id] : undefined;
  const stamp = `${id}:${version}:${offset ?? "latest"}`;
  const [result, setResult] = useState<{ stamp: string; value?: T; error?: string }>();
  // A new request (client, record, page, visibility or retry) drops the previous result first.
  const requestKey = [client, action, id, stamp, offset, enabled, active, revision] as const;
  const [seenRequestKey, setSeenRequestKey] = useState(requestKey);
  if (requestKey.some((value, index) => !Object.is(value, seenRequestKey[index]))) {
    setSeenRequestKey(requestKey);
    if (enabled && id && active) setResult(undefined);
  }
  useEffect(() => {
    if (!enabled || !id || !active) return;
    let alive = true;
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
  }, [client, action, id, stamp, offset, enabled, active, revision]);
  const current = result?.stamp === stamp ? result : undefined;
  return {
    value: current?.value,
    error: current?.error,
    loading: enabled && !current,
    retry: () => setRevision((value) => value + 1),
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
  const socialLocked = useSocialContext(SocialLockContext);
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
        disabled={socialLocked || loading || !page.offset}
        onClick={() => onPage(Math.max(0, page.offset - page.limit))}
      >
        {t("Previous records")}
      </Button>
      <Button
        variant="secondary"
        loading={loading}
        type="button"
        disabled={socialLocked || loading || page.offset + page.limit >= page.total}
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
      {detail.loading ? <LoadingText>{t("Loading interaction history")}</LoadingText> : null}
      {detail.error ? (
        <Notice kind="error">
          {detail.error}{" "}
          <Button variant="ghost" loading={detail.loading} onClick={detail.retry}>
            {t("Retry loading history")}
          </Button>
        </Notice>
      ) : null}
      <HistoryPageControls
        page={detail.value?.historyPage}
        loading={detail.loading}
        label={t("Contact interaction history pages")}
        onPage={detail.show}
      />
      {history.length ? (
        <table className="w-full text-ui-caption">
          <thead>
            <tr>
              <th>{t("Interaction")}</th>
              <th>{t("Date")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item, index) => (
              <tr key={`${item.operationId}:${index}`}>
                <td className="min-w-0 py-2">
                  <span>{socialContactHistoryLabel(item.kind)}</span>
                  {item.operationId || item.platformId ? (
                    <details className="mt-1 text-(--ui-text-secondary)">
                      <summary>{t("Technical details")}</summary>
                      <dl className="mt-1 flex min-w-0 flex-col gap-1">
                        <div className="wrap-anywhere">
                          <dt>{t("Event type")}</dt>
                          <dd>{item.kind}</dd>
                        </div>
                        {item.operationId ? (
                          <div className="wrap-anywhere">
                            <dt>{t("Operation")}</dt>
                            <dd>{item.operationId}</dd>
                          </div>
                        ) : null}
                        {item.platformId ? (
                          <div className="wrap-anywhere">
                            <dt>{t("Platform reference")}</dt>
                            <dd>{item.platformId}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </details>
                  ) : null}
                </td>
                <td className="py-2 align-top">
                  <time dateTime={new Date(item.at).toISOString()}>{time(item.at)}</time>
                </td>
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
