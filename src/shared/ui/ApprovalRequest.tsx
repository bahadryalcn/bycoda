import type { ReactNode } from "react";
import { Button } from "./Button";
import { Disclosure } from "./Disclosure";
import { Heading } from "./Heading";
import { NoticeGlyph, type NoticeAction } from "./Notice";
import { OutputBlock } from "./OutputBlock";

export type ApprovalRequestProps = {
  title: string;
  /** Exact command or request being approved. Never inferred from an action label. */
  detail: string;
  allow: NoticeAction;
  deny: NoticeAction;
  /** Persistent consent or review actions remain secondary. */
  actions?: readonly NoticeAction[];
  details?: { label: string; content: ReactNode; defaultOpen?: boolean };
};

/**
 * Owner approval with warning glyph, neutral title and the exact request on the code ground.
 * The caller owns authority, handlers and pending state; only Allow gets primary emphasis.
 * @group feedback
 * @use Tool, permission or owner requests requiring an explicit Allow/Deny decision.
 * @avoid Informational warning without a decision: Alert. OS readiness/setup rows: Row. Destructive confirmation: ConfirmDialog. Questions: forms.
 * @example
 * <ApprovalRequest title={t("Needs approval")} detail={command}
 *   allow={{ label: t("Allow"), onClick: allow }} deny={{ label: t("Deny"), onClick: deny }} />
 */
export function ApprovalRequest({
  title,
  detail,
  allow,
  deny,
  actions,
  details,
}: ApprovalRequestProps) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start gap-2">
        <NoticeGlyph tone="warning" size="box" />
        <Heading as="div" size="item">
          {title}
        </Heading>
      </div>
      <OutputBlock frame="filled" scroll className="max-h-48 min-w-0">
        {detail}
      </OutputBlock>
      {details ? (
        <Disclosure summary={details.label} defaultOpen={details.defaultOpen}>
          {details.content}
        </Disclosure>
      ) : null}
      <div className="flex flex-wrap items-center gap-2" data-no-drag="">
        {[allow, deny, ...(actions ?? [])].map((action, index) => (
          <Button
            key={index}
            variant={index === 0 ? "primary" : "ghost"}
            size="sm"
            type="button"
            motion="none"
            loading={action.pending ?? false}
            disabled={action.disabled}
            aria-label={action.ariaLabel}
            tooltip={action.disabled ? action.disabledReason : undefined}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
