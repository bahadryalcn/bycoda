import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import type { SecondOpinionMeta } from "../model/session";
import { HandoffFileCount, HarnessRoute } from "./HarnessRoute";

type Props = {
  card: SecondOpinionMeta;
};

export function SecondOpinionCard({ card }: Props) {
  const t = useT();

  return (
    <div className="min-w-0 font-sans">
      <Text as="div" size="secondary" tone="neutral" weight="medium" leading="snug">
        {card.kind === "handoff" ? t("Handoff") : t("Second opinion")}
      </Text>
      <Text as="div" size="micro" tone="secondary" className="mt-1 min-w-0">
        <HarnessRoute from={card.from} to={card.to} />
      </Text>
      <HandoffFileCount files={card.files} className="mt-1" />
    </div>
  );
}
