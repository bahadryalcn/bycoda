import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { useT } from "../../../shared/i18n";
import { Undo2 } from "../../../shared/ui/icons";
import type { Session } from "../model/session";
export function RewoundHistoryDisclosure({
  history,
  truncated = false,
}: {
  history: NonNullable<Session["rewindHistory"]>;
  truncated?: boolean;
}) {
  const t = useT();
  const summary = t("Rewound history ({p0})", { p0: history.length });
  return (
    <Disclosure
      data-rewind-history=""
      size="sm"
      summary={
        <span className="flex min-w-0 items-center gap-2">
          <Undo2 className="icon-sm shrink-0" aria-hidden />
          {summary}
        </span>
      }
      summaryLabel={summary}
      {...surfaceAttributes(
        { frame: "card", radius: "control" },
        "mx-auto my-2 w-[calc(100%-1.5rem)] max-w-4xl shrink-0 px-3 py-1",
      )}
    >
      {truncated ? (
        <Text as="p" size="inherit" tone="disabled" className="mt-1" aria-hidden>
          …
        </Text>
      ) : null}
      {/* The list owns its scroll inside a cap relative to the session pane, so the summary row
          stays put and the transcript keeps most of the pane. Focusable so keyboard users can scroll. */}
      <div
        role="region"
        aria-label={summary}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The capped history region needs keyboard scroll access.
        tabIndex={0}
        className="mt-2 flex max-h-[min(16rem,40cqb)] flex-col gap-3 overflow-y-auto overscroll-contain"
      >
        {[...history].reverse().map((entry) => (
          <section key={entry.id} className="flex flex-col gap-2">
            <Timestamp
              value={entry.createdAt}
              format="datetime-seconds"
              tooltip={false}
              tone="disabled"
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
                  variant="card"
                  padding="sm"
                  key={`${block.id}:${index}`}
                  className="min-w-0"
                >
                  {block.text ? (
                    <OutputBlock size="inherit" tone="neutral" face="sans">
                      {block.text}
                    </OutputBlock>
                  ) : null}
                  {block.attachments?.length ? (
                    <Text
                      as="div"
                      size="inherit"
                      tone="secondary"
                      className="mt-1 flex min-w-0 items-center gap-1.5"
                    >
                      <BadgeList
                        label={t("Attachments")}
                        size="xs"
                        className="min-w-0 flex-1"
                        items={block.attachments.map((file, index) => ({
                          id: `${index}:${file.name}`,
                          label: file.name,
                        }))}
                      />
                    </Text>
                  ) : null}
                </Surface>
              ))}
          </section>
        ))}
      </div>
    </Disclosure>
  );
}
