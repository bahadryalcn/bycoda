import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n/git";

/** The upstream branch of the checkout; it appears only when the changes pane is wide enough. */
export function UpstreamLabel({ upstream }: { upstream: string }) {
  useLocale();
  return (
    <Text
      truncate
      className="hidden min-w-0 shrink @min-[24rem]/changes:block"
      title={`${t("Upstream")} ${upstream}`}
    >
      {upstream}
    </Text>
  );
}
