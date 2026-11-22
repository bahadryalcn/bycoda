import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { createContext, useContext } from "react";
import { z } from "zod";
import { formatNumber, useT } from "../../../../shared/i18n";
import { BarChart } from "../../../../shared/ui/Charts";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { Heading } from "../../../../shared/ui/Heading";
import { Text } from "../../../../shared/ui/Text";
import type { VoicePresentedResult } from "../../model/voicePresentedResult";

const ResultContext = createContext<VoicePresentedResult | undefined>(undefined);

const PresentedAnswer = defineComponent({
  name: "PresentedAnswer",
  description: "A visual answer for the current voice turn.",
  props: z.object({}),
  component: function PresentedAnswerView() {
    const result = useContext(ResultContext);
    const t = useT();
    if (!result) return null;
    const { content } = result;
    return (
      <article className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
        <div className="grid gap-1">
          <Heading as="h3" size="section">
            {result.title}
          </Heading>
          <Text as="p" tone="secondary">
            {result.summary}
          </Text>
        </div>
        {content?.kind === "notes" && (
          <ul className="grid list-disc gap-2 ps-4">
            {content.items.map((item, index) => (
              <Text key={index} as="li">
                {item}
              </Text>
            ))}
          </ul>
        )}
        {content?.kind === "comparison" && (
          <DescriptionList>
            {content.items.map(({ label, value }, index) => (
              <DescriptionItem key={index} term={label}>
                {value}
              </DescriptionItem>
            ))}
          </DescriptionList>
        )}
        {content?.kind === "chart" && (
          <BarChart
            data={content.items.map((item, index) => ({
              key: String(index),
              axisLabel: item.label,
              ...item,
            }))}
            label={result.title}
            period=""
            categoryLabel={t("Name")}
            showAverage={false}
            formatValue={(value) => formatNumber(value)}
            height={168}
          />
        )}
      </article>
    );
  },
});

const library = createLibrary({ components: [PresentedAnswer], root: "PresentedAnswer" });

/** Keep model-provided text out of the OpenUI program and render it as React text. */
export default function VoicePresentedAnswer({ result }: { result: VoicePresentedResult }) {
  return (
    <ResultContext.Provider value={result}>
      <Renderer library={library} response="root = PresentedAnswer()" />
    </ResultContext.Provider>
  );
}
