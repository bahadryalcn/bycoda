import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { dateTimeFormat } from "../../../shared/lib/intl";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { useLocale, useT } from "../../../shared/i18n";
import type { Session } from "../model/session";
export function RewoundHistoryDisclosure({
  history,
  truncated = false,
}: {
  history: NonNullable<Session["rewindHistory"]>;
  truncated?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <details
      data-rewind-history
      className="mx-auto max-h-64 w-full max-w-4xl shrink-0 overflow-y-auto border-b border-(--ui-tone-neutral-border) px-3 py-2 text-ui-caption text-[var(--ui-text-secondary)]"
    >
      <summary className="cursor-pointer hover:text-(--ui-tone-neutral-fg)">
        {t("Rewound history ({p0})", { p0: history.length })}
      </summary>
      {truncated ? (
        <p className="mt-1 text-[var(--ui-text-disabled)]">
          {t("Showing a preview of rewound history.")}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-3">
        {[...history].reverse().map((entry) => (
          <section key={entry.id} className="flex flex-col gap-2">
            <time
              dateTime={isoTimestamp(entry.createdAt)}
              className="text-[var(--ui-text-disabled)]"
            >
              {dateTimeFormat(locale, {
                year: "numeric",
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
                second: "numeric",
              }).format(entry.createdAt)}
            </time>
            {entry.blocks
              .filter(
                (block) =>
                  !block.internal &&
                  !block.draft &&
                  (Boolean(block.text) || Boolean(block.attachments?.length)),
              )
              .map((block, index) => (
                <article
                  key={`${block.id}:${index}`}
                  className="min-w-0 rounded-md border border-(--ui-pane-border) px-2.5 py-2"
                >
                  {block.text ? (
                    <pre className="select-text whitespace-pre-wrap break-words font-sans text-(--ui-tone-neutral-fg)">
                      {block.text}
                    </pre>
                  ) : null}
                  {block.attachments?.length ? (
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[var(--ui-text-secondary)]">
                      <span className="shrink-0">{t("Attachments")}:</span>
                      <BadgeList
                        label={t("Attachments")}
                        size="xs"
                        className="min-w-0 flex-1"
                        items={block.attachments.map((file, index) => ({
                          id: `${index}:${file.name}`,
                          label: file.name,
                        }))}
                      />
                    </div>
                  ) : null}
                </article>
              ))}
          </section>
        ))}
      </div>
    </details>
  );
}
