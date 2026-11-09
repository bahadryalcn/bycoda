import type { ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";

export type WaitingForYouProps = {
  approvalCount: number;
  /** Browser checks waiting for the owner; added to the header count. */
  humanCount?: number;
  /** The browser checks the owner completes: the screen passes its NeedsHumanList here. */
  children: ReactNode;
};

/** What only the owner can do: browser checks, and actions waiting for approval. */
export function WaitingForYou({ approvalCount, humanCount = 0, children }: WaitingForYouProps) {
  const total = approvalCount + humanCount;
  return (
    <section className="command-frame" aria-label={t("Waiting for you")}>
      <header className="command-frame-header">
        <h3 className="command-section-title">{t("Waiting for you")}</h3>
        {total > 0 ? (
          <Badge tone="warning" size="sm" aria-label={t("{p0} waiting for you", { p0: total })}>
            {total}
          </Badge>
        ) : null}
      </header>
      {approvalCount > 0 ? (
        <p className="sr-only">
          {approvalCount === 1
            ? t("{p0} action waits for your approval.", { p0: approvalCount })
            : t("{p0} actions wait for your approval.", { p0: approvalCount })}
        </p>
      ) : null}
      <div className="command-frame-body">{children}</div>
    </section>
  );
}
