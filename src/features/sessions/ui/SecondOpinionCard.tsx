import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { ChevronRight } from "../../../shared/ui/icons";
import { HARNESS_TITLE, type SecondOpinionMeta } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

type Props = {
  card: SecondOpinionMeta;
};

export function SecondOpinionCard({ card }: Props) {
  const t = useT();
  const files =
    card.files != null && card.files > 0
      ? `${card.files} ${card.files === 1 ? "file" : "files"}`
      : null;

  return (
    <div className="min-w-0 font-sans">
      <Text as="div" size="secondary" tone="neutral" weight="medium" leading="snug">
        {card.kind === "handoff" ? t("Handoff") : t("Second opinion")}
      </Text>
      <Text
        as="div"
        size="micro"
        tone="secondary"
        className="mt-1 flex min-w-0 items-center gap-1.5"
      >
        <HarnessIcon harness={card.from} className="size-3 shrink-0" />
        <Text size="inherit" tone="inherit" truncate>
          {HARNESS_TITLE[card.from]}
        </Text>
        <ChevronRight className="icon-xs shrink-0" tone="secondary" strokeWidth={1.75} />
        <HarnessIcon harness={card.to} className="size-3 shrink-0" />
        <Text size="inherit" tone="inherit" truncate>
          {HARNESS_TITLE[card.to]}
        </Text>
      </Text>
      {files ? (
        <Text as="div" size="micro" tone="secondary" className="mt-1">
          {files}
        </Text>
      ) : null}
    </div>
  );
}
