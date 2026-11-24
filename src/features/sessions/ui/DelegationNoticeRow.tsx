import { useContext } from "react";
import { useT } from "../../../shared/i18n";
import { ClampText } from "../../../shared/ui/ClampText";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Check, CircleX, Square } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import { delegationNoticeSections } from "../model/delegationNotice";
import type { Block } from "../model/session";
import { useDelegatedRunIds } from "../model/reactiveReads";
import { DelegatedRunOwner } from "./SubagentCards";

/**
 * A subagent completion or peer message the Host delivered to the main agent. It is not the
 * owner speaking: a child with a card in this transcript already shows its report there, so
 * its section folds into that card; any other section is a compact notice with its text
 * behind a disclosure.
 */
export function DelegationNoticeRow({ block }: { block: Block }) {
  const t = useT();
  const parentId = useContext(DelegatedRunOwner);
  // The runs that have a card; a section of one of them is shown on its card.
  const carded = useDelegatedRunIds(parentId);
  if (block.author?.kind !== "delegation") return null;
  const sections = delegationNoticeSections(block.text, block.author).filter(
    (section) => !carded.includes(section.runId),
  );
  // The prompt rail lists every notice, so a notice folded into its card still marks its place.
  if (!sections.length) return <div data-outline-anchor={block.id} />;
  return (
    <div
      data-outline-anchor={block.id}
      data-delegation-notice
      className="flex min-w-0 flex-col gap-0.5 px-4 font-sans pbs-1 pbe-1.5"
    >
      {sections.map((section, index) => (
        <Disclosure
          key={`${section.runId}:${index}`}
          variant="step"
          chevron="end"
          summary={
            <span className="flex min-w-0 items-center gap-2">
              <Text size="inherit" tone="inherit" truncate className="min-w-0">
                {section.reason === "completion"
                  ? t("Result from {p0}", { p0: section.title })
                  : t("Message from {p0}", { p0: section.title })}
              </Text>
              {section.status === "succeeded" ? (
                <Check className="icon-sm shrink-0" tone="success" aria-label={t("Done")} />
              ) : section.status === "failed" ? (
                <CircleX className="icon-sm shrink-0" tone="danger" aria-label={t("Failed")} />
              ) : section.status ? (
                <Square
                  className="icon-sm shrink-0"
                  tone="warning"
                  aria-label={t("Stopped by you")}
                />
              ) : null}
            </span>
          }
        >
          <ClampText
            as="div"
            lines={8}
            size="caption"
            tone="secondary"
            className="whitespace-pre-wrap [overflow-wrap:anywhere] ps-5"
          >
            {section.body}
          </ClampText>
        </Disclosure>
      ))}
    </div>
  );
}
