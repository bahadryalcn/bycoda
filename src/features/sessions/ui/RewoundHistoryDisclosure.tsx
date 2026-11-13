import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
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
      {...surfaceAttributes(
        { frame: "neutral", edge: "bottom" },
        "mx-auto max-h-64 w-full max-w-4xl shrink-0 overflow-y-auto px-3 py-2",
      )}
    >
      {truncated ? (
        <Text as="p" size="inherit" tone="disabled" className="mt-1">
          {t("Showing a preview of rewound history.")}
        </Text>
      ) : null}
      <div className="mt-2 flex flex-col gap-3">
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
                  variant="outline"
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
