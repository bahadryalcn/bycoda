import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";

/** A lower bound is marked with + until the provider confirms completeness. */
export function InboxCollectionStatus({
  count,
  limited,
  partial,
  total,
}: {
  count: number;
  limited: boolean;
  partial: boolean;
  total?: number;
}) {
  useLocale();
  return (
    <Text
      as="div"
      size="micro"
      tone="secondary"
      data-inbox-list-status
      className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 tabular-nums"
    >
      <LiveText
        text={t("{p0} items", { p0: `${total ?? count}${total == null && limited ? "+" : ""}` })}
      />
      {partial ? (
        <Text size="inherit" tone="warning">
          {t("Partial")}
        </Text>
      ) : null}
    </Text>
  );
}
