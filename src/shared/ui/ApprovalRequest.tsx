import type { ReactNode } from "react";
import { Button } from "./Button";
import { Disclosure } from "./Disclosure";
import { Heading } from "./Heading";
import { MiddleTruncate } from "./MiddleTruncate";
import { NoticeGlyph, type NoticeAction } from "./Notice";
import { OutputBlock } from "./OutputBlock";
import { Text } from "./Text";

export type ApprovalRequestProps = {
  title: string;
  /** Exact command or request being approved. Never inferred from an action label. */
  detail: string;
  allow: NoticeAction;
  deny: NoticeAction;
  /** Hide the repeated visible title when the surrounding row already identifies the request. */
  appearance?: "compact";
  /** Scope that affects the decision, e.g. "This request only". */
  scope?: string;
  /** Working directory that bounds the request. Its full value is available on overflow. */
  path?: string;
  /** Existing unstructured context lines. Prefer `scope` and `path` for new callers. */
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
 * <ApprovalRequest title={t("Allow {p0}?", { p0: toolName })} detail={command} path={cwd} scope={t("This request only")}
 *   allow={{ label: t("Allow"), onClick: allow }} deny={{ label: t("Deny"), onClick: deny }} />
 */
export function ApprovalRequest({
  title,
  detail,
  allow,
  deny,
  appearance,
  scope,
  path,
  context,
  actions,
  details,
}: ApprovalRequestProps) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {appearance !== "compact" ? (
          <div className="flex min-w-0 items-center gap-1">
            <NoticeGlyph tone="warning" size="inline" />
            <Heading as="div" size="item">
              {title}
            </Heading>
          </div>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2" data-no-drag="">
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
              disabledReason={action.disabledReason}
              tooltip={action.tooltip}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
      {scope ? (
        <Text as="div" wrap="anywhere">
          {scope}
        </Text>
      ) : null}
      {path ? (
        <MiddleTruncate mode="path" size="caption" tone="secondary">
          {path}
        </MiddleTruncate>
      ) : null}
      {context?.map((item, index) => (
        <Text as="div" size="caption" tone="secondary" wrap="anywhere" key={index}>
          {item}
        </Text>
      ))}
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
