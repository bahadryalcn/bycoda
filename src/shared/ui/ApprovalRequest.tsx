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
  /** Readable view of `detail` shown in its place. It must keep `detail` itself one click away. */
  summary?: ReactNode;
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
  /** `none` leaves the buttons to the caller, a dialog's footer with ApprovalActions. */
  actionsPlacement?: "header" | "none";
};

/**
 * Owner approval: a title line (subtle warning glyph), quiet folder and scope metadata, the exact
 * request on the code ground, optional details, then the decision buttons ending with Allow. A dialog
 * passes `actionsPlacement="none"` and puts ApprovalActions in its Modal footer instead. Frameless:
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
  summary,
  allow,
  deny,
  appearance,
  scope,
  path,
  context,
  actions,
  details,
  actionsPlacement = "header",
}: ApprovalRequestProps) {
  const hasContext = Boolean(scope || path || context?.length);
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 font-sans">
      {appearance !== "compact" ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <NoticeGlyph tone="warning" size="inline" />
          <Heading as="div" size="item">
            {title}
          </Heading>
        </div>
      ) : null}
      {hasContext ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {path ? (
            <div className="min-w-0 max-w-full">
              <MiddleTruncate mode="path" size="caption" tone="secondary">
                {path}
              </MiddleTruncate>
            </div>
          ) : null}
          {scope ? (
            <Text as="div" size="caption" tone="secondary" wrap="anywhere">
              {scope}
            </Text>
          ) : null}
          {context?.map((item, index) => (
            <Text as="div" size="caption" tone="secondary" wrap="anywhere" key={index}>
              {item}
            </Text>
          ))}
        </div>
      ) : null}
      {summary ?? (
        <OutputBlock frame="filled" scroll className="max-h-48 min-w-0">
          {detail}
        </OutputBlock>
      )}
      {details ? (
        <Disclosure variant="compact" summary={details.label} defaultOpen={details.defaultOpen}>
          {details.content}
        </Disclosure>
      ) : null}
      {actionsPlacement === "header" ? (
        <div className="flex flex-wrap items-center justify-end gap-2" data-no-drag="">
          <ApprovalActions allow={allow} deny={deny} actions={actions} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The decision buttons of an ApprovalRequest, secondary actions first and Allow last as the only
 * primary. Render them in a Modal footer (inside ModalActions) when the request uses
 * `actionsPlacement="none"`.
 * @group feedback
 * @status internal
 * @use The Deny/Allow buttons of an ApprovalRequest shown in a dialog footer.
 * @avoid The request itself with inline buttons: ApprovalRequest.
 */
export function ApprovalActions({
  allow,
  deny,
  actions,
}: Pick<ApprovalRequestProps, "allow" | "deny" | "actions">) {
  return [...(actions ?? []), deny, allow].map((action, index, all) => (
    <Button
      key={index}
      variant={index === all.length - 1 ? "primary" : action === deny ? "secondary" : "ghost"}
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
  ));
}
