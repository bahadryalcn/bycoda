import { useInfiniteQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { ListRow } from "../../../../../shared/ui/ListRow";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Text } from "../../../../../shared/ui/Text";
import { presentRemoteError } from "../../../../connections/public/remoteFailure";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { socialQueryScope } from "../../../model/socialQuery";
import { YouTubeFields } from "./YouTubeFields";
import { withDefaults, youtubePayload } from "./YouTubeFormFields";
import { asYoutubeRecord, listRows, rowSummary, YouTubeResult } from "./YouTubeResult";
import type { YouTubeOperation } from "../../../model/youtubeManagement";
import type { YouTubeDraft, YouTubeForm } from "./youtubeForms";

/** Rows the owner can choose from; each reads as a title and a few short facts. */
function YouTubeRows({
  rows,
  selectedId,
  onPick,
}: {
  rows: Record<string, unknown>[];
  selectedId?: string;
  onPick?: (row: Record<string, unknown>) => void;
}) {
  return (
    <ul className="youtube-rows">
      {rows.map((row, index) => {
        const { title, meta } = rowSummary(row);
        const id = typeof row.id === "string" ? row.id : undefined;
        const content = (
          <span className="youtube-row">
            <Text as="span" weight="medium" truncate>
              {title}
            </Text>
            {meta.length ? (
              <Text as="span" size="caption" tone="secondary" truncate>
                {meta.join(" · ")}
              </Text>
            ) : null}
          </span>
        );
        return (
          <li key={id ?? index}>
            {onPick && id ? (
              <ListRow
                size="md"
                selected={id === selectedId}
                aria-pressed={id === selectedId}
                data-has-description={meta.length ? "" : undefined}
                onClick={() => onPick(row)}
              >
                {content}
              </ListRow>
            ) : (
              <div className="youtube-row-static">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The read side of a section: filters, a Refresh action and the list or facts the form returns.
 * API accounts load as soon as the section opens; browser accounts wait for an explicit Load,
 * because reading drives the owner's browser.
 */
export function YouTubeBrowse({
  client,
  account,
  form,
  title,
  lead,
  draft,
  setField,
  blocked,
  browser,
  selectedId,
  onPick,
  review,
  reconcile,
  emptyText,
}: {
  client: SocialClient;
  account: SocialAccount;
  form: YouTubeForm;
  title: string;
  /** Replaces the title in the head row, for the view switch of a section with several lists. */
  lead?: ReactNode;
  draft: YouTubeDraft;
  setField(key: string, value: string | File[]): void;
  blocked: boolean;
  browser: boolean;
  selectedId?: string;
  onPick?: (row: Record<string, unknown>) => void;
  review?: (operation: YouTubeOperation) => void;
  reconcile?: (operation: YouTubeOperation, status: "done" | "rejected") => void;
  emptyText: string;
}) {
  const [requested, setRequested] = useState("");
  const effective = withDefaults(form, draft);
  const fields = form.fields ?? [];
  const ready = fields.every(({ key, required }) => !required || Boolean(effective[key]?.length));
  const filters = JSON.stringify(
    fields.map(({ key }) => [key, typeof effective[key] === "string" ? effective[key] : ""]),
  );
  const queryKey = [
    ...socialQueryScope(client),
    "youtube",
    account.id,
    "browse",
    form.action,
    filters,
  ];
  const requestKey = JSON.stringify(queryKey);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) =>
      await client.request(form.action, {
        ...(await youtubePayload(form, effective, account.id)),
        ...pageParam,
      }),
    initialPageParam: {} as Record<string, unknown>,
    getNextPageParam: (last) => {
      const data = asYoutubeRecord(last);
      return typeof data?.next === "string"
        ? { cursor: data.next }
        : typeof data?.nextStartIndex === "number"
          ? { startIndex: data.nextStartIndex }
          : undefined;
    },
    enabled: ready && !blocked && (!browser || requested === requestKey),
    staleTime: 15_000,
  });
  const pages = query.data?.pages ?? [];
  const rows = pages.length ? pages.flatMap((page) => listRows(page) ?? []) : undefined;
  const isList = pages.length > 0 && listRows(pages[0]) !== undefined;
  const loadLabel = browser && requested !== requestKey ? t("Load") : t("Refresh");
  const refresh = () => {
    if (browser && requested !== requestKey) setRequested(requestKey);
    else query.refetch().catch(() => undefined);
  };
  return (
    <section className="youtube-browse" aria-label={title || t("YouTube management")}>
      <div className="youtube-head">
        {lead ?? (title ? <SectionLabel as="h3">{title}</SectionLabel> : <span />)}
        <Button
          size="sm"
          variant="ghost"
          disabled={blocked || !ready}
          loading={query.isFetching && !query.isFetchingNextPage}
          onClick={refresh}
        >
          {loadLabel}
        </Button>
      </div>
      {fields.length ? (
        <YouTubeFields
          key={form.action}
          client={client}
          accountId={account.id}
          fields={fields}
          draft={effective}
          setField={setField}
          disabled={blocked}
          enabled={!blocked}
          unset={t("Any")}
          listAvailable
        />
      ) : null}
      {query.isError ? (
        <InlineError>
          {presentRemoteError(query.error, { explicit: true }) ||
            t("The YouTube operation failed.")}
        </InlineError>
      ) : null}
      {query.isPending && query.fetchStatus !== "idle" ? <LoadingText /> : null}
      {query.isPending && query.fetchStatus === "idle" && !blocked ? (
        <Text size="caption" tone="secondary">
          {!ready
            ? t("Choose an option above to see its items.")
            : t("Press Load to read this from YouTube.")}
        </Text>
      ) : null}
      {rows && isList && !review && !reconcile ? (
        rows.length ? (
          <YouTubeRows rows={rows} selectedId={selectedId} onPick={onPick} />
        ) : (
          <EmptyState size="inline" context="list" title={emptyText} />
        )
      ) : null}
      {pages[0] !== undefined && (!isList || review || reconcile) ? (
        <YouTubeResult
          result={rows && isList ? { items: rows } : pages[0]}
          busy={query.isFetching}
          review={review}
          reconcile={reconcile}
        />
      ) : null}
      {query.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          loading={query.isFetchingNextPage}
          onClick={() => {
            query.fetchNextPage().catch(() => undefined);
          }}
        >
          {t("Load more")}
        </Button>
      ) : null}
    </section>
  );
}
