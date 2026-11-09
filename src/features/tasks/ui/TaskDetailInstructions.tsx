import { t, useLocale } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";
import { readTaskInstructions } from "../model/taskInstructions";
import "./task-detail.css";

function ItemList({ title, items }: { title: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <section className="task-detail-section">
      <SectionLabel as="h3" count={items.length}>
        {title}
      </SectionLabel>
      <ul className="task-detail-list">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** The task brief as quiet labelled sections. A structured brief shows its
 * objective, deliverables, acceptance criteria, constraints and verification;
 * a plain prompt shows as one description. */
export function TaskDetailInstructions({ prompt }: { prompt: string }) {
  useLocale();
  const brief = readTaskInstructions(prompt);
  const text = brief ? brief.objective : prompt.trim();
  return (
    <div data-task-detail-description className="task-detail-instructions">
      <section className="task-detail-section">
        <SectionLabel as="h3">{t("Description")}</SectionLabel>
        {text ? (
          <AgentMarkdown text={text} allowRemoteMedia={false} />
        ) : (
          <EmptyState size="inline" description={t("No description.")} />
        )}
      </section>
      {brief ? (
        <>
          <ItemList title={t("Deliverables")} items={brief.deliverables} />
          <ItemList title={t("Acceptance criteria")} items={brief.acceptance} />
          <ItemList title={t("Constraints")} items={brief.constraints} />
          <ItemList title={t("Verification")} items={brief.verification} />
        </>
      ) : null}
    </div>
  );
}
