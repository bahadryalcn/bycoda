import type { ReactNode } from "react";
import { formatNumber } from "../../../../shared/i18n";
import { Text } from "../../../../shared/ui/Text";

const REPORT_LIMIT = 20;

export function AudienceReportList<Item>({
  items,
  renderRow,
  overflowLabel,
}: {
  items: readonly Item[];
  renderRow: (item: Item) => ReactNode;
  overflowLabel: (count: string) => string;
}) {
  if (!items.length) return null;
  const remaining = items.length - REPORT_LIMIT;
  return (
    <>
      <ul className="audience-list">{items.slice(0, REPORT_LIMIT).map(renderRow)}</ul>
      {remaining > 0 ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className="audience-muted">
          {overflowLabel(formatNumber(remaining))}
        </Text>
      ) : null}
    </>
  );
}
