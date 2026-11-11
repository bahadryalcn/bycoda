import { Timestamp } from "../../../shared/ui/Timestamp";
import { Surface } from "../../../shared/ui/Surface";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { useT } from "../../../shared/i18n";
import type { Session } from "../model/session";
export function RewoundHistoryDisclosure({
  history,
  truncated = false,
}: {
  history: NonNullable<Session["rewindHistory"]>;
  truncated?: boolean;
}) {
  const t = useT();
  return (
    <Disclosure
      data-rewind-history=""
      size="sm"
      summary={t("Rewound history ({p0})", { p0: history.length })}
      className="mx-auto max-h-64 w-full max-w-4xl shrink-0 overflow-y-auto border-b border-(--ui-tone-neutral-border) px-3 py-2"
    >
      {truncated ? (
        <p className="mt-1 text-[var(--ui-text-disabled)]">
          {t("Showing a preview of rewound history.")}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-3">
        {[...history].reverse().map((entry) => (
          <section key={entry.id} className="flex flex-col gap-2">
            <Timestamp
              value={entry.createdAt}
              format="datetime-seconds"
              tooltip={false}
              className="text-[var(--ui-text-disabled)]"
            />
            {entry.blocks
              .filter(
                (block) =>
                  !block.internal &&
                  !block.draft &&
                  (Boolean(block.text) || Boolean(block.attachments?.length)),
              )
              .map((block, index) => (
                <Surface
                  as="article"
                  variant="outline"
                  padding="sm"
                  key={`${block.id}:${index}`}
                  className="min-w-0"
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
                </Surface>
              ))}
          </section>
        ))}
      </div>
    </Disclosure>
  );
}
