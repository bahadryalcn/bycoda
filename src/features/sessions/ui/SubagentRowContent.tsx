import type { ReactNode } from "react";
import { actionContentAttributes } from "../../../shared/ui/ActionHost";
import { motionAttributes } from "../../../shared/ui/Motion";
import { Text } from "../../../shared/ui/Text";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { HarnessId } from "../model/session";
import type { ModelAccountIdentity } from "./ModelAccountIdentity";
import { SubagentMarks } from "./SubagentAnatomy";
import styles from "./SubagentRow.module.css";

/**
 * The two-line card of one delegated run, in the transcript and in the activity dock: the
 * provider across both lines, the name above its detail, and the run's state at the end.
 * The name and detail give room back, so a run named with its whole brief keeps its state visible.
 */
export function SubagentRowContent({
  harness,
  model,
  account,
  name,
  active,
  failed,
  handle,
  subtitle,
  details,
  status,
  chevron,
  layout = "transcript",
}: {
  harness?: HarnessId;
  /** Model id; names the provider when `harness` is not known. */
  model?: string;
  account?: ModelAccountIdentity;
  name: string;
  active: boolean;
  failed: boolean;
  /** A Crew member's handle, beside the name. */
  handle?: string;
  /** The task, leading the detail line. */
  subtitle?: string;
  details: readonly (string | undefined)[];
  status: ReactNode;
  chevron?: ReactNode;
  /** `dock` leaves the chevron and row actions to its host row. */
  layout?: "transcript" | "dock";
}) {
  const detail = details.filter(Boolean).join(" · ");
  const nameClass = "min-w-0 text-start font-sans";
  return (
    <span className={styles.content} data-layout={layout}>
      <SubagentMarks className={styles.mark} harness={harness} model={model} account={account} />
      <span className={styles.identity} data-subagent-identity>
        <span className={styles.titleLine} data-subagent-title>
          {active ? (
            <WorkingIndicator
              glyph={false}
              className={nameClass}
              truncate
              text={{ size: "body", weight: "medium" }}
            >
              {name}
            </WorkingIndicator>
          ) : (
            <Text
              size="body"
              weight="medium"
              truncate
              tone={failed ? "danger" : "secondary"}
              {...motionAttributes({ transition: "colors", duration: "standard" })}
              {...actionContentAttributes(
                { phase: "always", interactionTone: failed ? undefined : "neutral" },
                nameClass,
              )}
            >
              {name}
            </Text>
          )}
          {handle ? (
            <Text size="micro" tone="muted" truncate className="min-w-0 shrink-[8]">
              @{handle}
            </Text>
          ) : null}
        </span>
        {subtitle || detail ? (
          <span className={styles.meta}>
            {subtitle ? (
              <Text size="micro" tone="muted" truncate className="max-w-[55%] shrink-0">
                {subtitle}
                {detail ? " ·" : ""}
              </Text>
            ) : null}
            {detail ? (
              <Text size="micro" tone="muted" truncate className="min-w-0 flex-1">
                {detail}
              </Text>
            ) : null}
          </span>
        ) : null}
      </span>
      {status}
      {chevron ? (
        <span className={styles.chevron} aria-hidden="true">
          {chevron}
        </span>
      ) : null}
    </span>
  );
}
