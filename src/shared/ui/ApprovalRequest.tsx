import type { ReactNode } from "react";
import { Button } from "./Button";
import { Disclosure } from "./Disclosure";
import { Heading } from "./Heading";
import { NoticeGlyph, type NoticeAction } from "./Notice";
import { OutputBlock } from "./OutputBlock";
import { Text } from "./Text";

export type ApprovalRequestProps = {
  title: string;
  /** Exact command or request being approved. Never inferred from an action label. */
  detail: string;
  allow: NoticeAction;
  deny: NoticeAction;
  /** Where and how far the decision reaches, e.g. working directory and "this request only". */
  context?: readonly string[];
  /** Persistent consent or review actions remain secondary. */
  actions?: readonly NoticeAction[];
  details?: { label: string; content: ReactNode; defaultOpen?: boolean };
};

/**
 * Owner approval: one header line (warning glyph, title, then the decision buttons ending with
 * Allow), the exact request on the code ground below it, and optional details last. Frameless:
 * the caller places it in its card, pane or dialog. The caller owns authority, handlers and
 * pending state; only Allow gets primary emphasis.
 * @group feedback
 * @use Tool, permission or owner requests requiring an explicit Allow/Deny decision.
 * @avoid Informational warning without a decision: Alert. OS readiness/setup rows: Row. Destructive confirmation: ConfirmDialog. Questions: forms.
 * @example
 * <ApprovalRequest title={t("Allow {p0}?", { p0: toolName })} detail={command} context={[cwd, t("This request only")]}
 *   allow={{ label: t("Allow"), onClick: allow }} deny={{ label: t("Deny"), onClick: deny }} />
 */
export function ApprovalRequest({
  title,
  detail,
  allow,
  deny,
  context,
  actions,
  details,
}: ApprovalRequestProps) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <NoticeGlyph tone="warning" size="inline" />
          <Heading as="div" size="item">
            {title}
          </Heading>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-1.5" data-no-drag="">
          {[...(actions ?? []), deny, allow].map((action, index, all) => (
            <Button
              key={index}
              variant={index === all.length - 1 ? "primary" : "ghost"}
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
      </div>
      {context?.length ? (
        <Text as="div" size="caption" tone="secondary" truncate>
          {context.join(" · ")}
        </Text>
      ) : null}
      <OutputBlock frame="filled" scroll className="max-h-48 min-w-0">
        {detail}
      </OutputBlock>
      {details ? (
        <Disclosure summary={details.label} defaultOpen={details.defaultOpen}>
          {details.content}
        </Disclosure>
      ) : null}
    </section>
  );
}
