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
  /** Readable view of `detail` shown in its place. It must keep `detail` itself one click away. */
  summary?: ReactNode;
  allow: NoticeAction;
  deny: NoticeAction;
  /** Persistent consent or review actions remain secondary. */
  actions?: readonly NoticeAction[];
  details?: { label: string; content: ReactNode; defaultOpen?: boolean };
  /** `none` leaves the buttons to the caller, a dialog's footer with ApprovalActions. */
  actionsPlacement?: "header" | "none";
};

/**
 * Owner approval: one header line (warning glyph, title, then the decision buttons ending with
 * Allow), the exact request on the code ground below it, and optional details last. A dialog
 * passes `actionsPlacement="none"` and puts ApprovalActions in its Modal footer instead. Frameless:
 * the caller places it in its card, pane or dialog. The caller owns authority, handlers and
 * pending state; only Allow gets primary emphasis.
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
  summary,
  allow,
  deny,
  actions,
  details,
  actionsPlacement = "header",
}: ApprovalRequestProps) {
  const buttons = <ApprovalActions allow={allow} deny={deny} actions={actions} />;
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <NoticeGlyph tone="warning" size="inline" />
          <Heading as="div" size="item">
            {title}
          </Heading>
        </div>
        {actionsPlacement === "header" ? (
          <div className="ms-auto flex flex-wrap items-center gap-1.5" data-no-drag="">
            {buttons}
          </div>
        ) : null}
      </div>
      {summary ?? (
        <OutputBlock frame="filled" scroll className="max-h-48 min-w-0">
          {detail}
        </OutputBlock>
      )}
      {details ? (
        <Disclosure summary={details.label} defaultOpen={details.defaultOpen}>
          {details.content}
        </Disclosure>
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
  ));
}
