import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { Replace, Eye } from "../../../shared/ui/icons";
import type { SecondOpinionMeta } from "../model/session";
import { HandoffFileCount, HarnessRoute } from "./HarnessRoute";

type Props = {
  card: SecondOpinionMeta;
};

/** The route card inside a user bubble: title, from > to, file count. */
export function SecondOpinionCard({ card }: Props) {
  const t = useT();
  const handoff = card.kind === "handoff";
  const Icon = handoff ? Replace : Eye;

  return (
    <Surface variant="card" padding="sm" className="grid min-w-0 gap-1 font-sans">
      <Text
        as="div"
        size="secondary"
        tone="inherit"
        weight="medium"
        leading="snug"
        className="flex items-center gap-1.5 text-(--transcript-ink-emphasis)"
      >
        <Icon className="icon-sm shrink-0 text-(--transcript-ink-chrome)" aria-hidden />
        {handoff ? t("Handoff") : t("Second opinion")}
      </Text>
      <Text as="div" size="micro" tone="secondary" className="min-w-0">
        <HarnessRoute from={card.from} to={card.to} />
      </Text>
      <HandoffFileCount files={card.files} />
    </Surface>
  );
}
