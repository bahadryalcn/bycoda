import { Badge } from "../../../shared/ui/Badge";
import type { InboxStatusMark } from "./InboxPresentation";

/** Lifecycle and owner attention remain separate meanings in detail headers. */
export function InboxStatusBadge({
  mark,
  label,
  attention,
}: {
  mark: InboxStatusMark;
  label: string;
  attention?: string;
}) {
  return (
    <>
      <Badge size="xs" tone={mark.tone} appearance="subtle" icon={<mark.Icon strokeWidth={1.75} />}>
        {label}
      </Badge>
      {attention ? (
        <Badge size="xs" tone="warning">
          {attention}
        </Badge>
      ) : null}
    </>
  );
}
