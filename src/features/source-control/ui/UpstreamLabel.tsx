import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n/git";

/** The upstream branch of the checkout; it appears only when the changes pane is wide enough. */
export function UpstreamLabel({ upstream }: { upstream: string }) {
  useLocale();
  return (
    <Tooltip label={`${t("Upstream")} ${upstream}`} asChild>
      <Text truncate className="hidden min-w-0 shrink @min-[24rem]/changes:block">
        {upstream}
      </Text>
    </Tooltip>
  );
}
