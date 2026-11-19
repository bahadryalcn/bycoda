import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { ButtonGroup } from "../../shared/ui/ButtonGroup";
import { useT } from "../../shared/i18n";
import { X } from "../../shared/ui/icons";
import { BrandMark } from "../../shared/ui/BrandMark";
import type { InstalledUpdate } from "../model/updateNotice";

type Props = {
  update: InstalledUpdate | null;
  onOpen: (version: string) => void;
  onDismiss: () => void;
};

export function UpdateRailCard({ update, onOpen, onDismiss }: Props) {
  const t = useT();
  if (!update) return null;
  // The complete message is one translation key so translators can reorder the version.
  const updatedLabel = t("Updated to {p0}", { p0: update.version });

  return (
    <section role="status" className="min-w-0">
      <ButtonGroup aria-label={updatedLabel}>
        <Button
          variant="item"
          motion="none"
          type="button"
          onClick={() => onOpen(update.version)}
          align="start"
          aria-label={updatedLabel}
          className="min-w-0 flex-1"
        >
          <BrandMark aria-hidden className="size-4 shrink-0 object-contain" />
          {/* Compact rails keep the logo as the icon fallback; the name stays on the button. */}
          <Text
            size="caption"
            tone="primary"
            weight="medium"
            truncate
            className="min-w-0 @max-[140px]/rail:hidden"
          >
            {updatedLabel}
          </Text>
          <Text size="caption" tone="primary" className="shrink-0 @max-[240px]/rail:hidden">
            {t("What's new")}
          </Text>
        </Button>
        <Button
          iconOnly
          label={t("Dismiss update notification")}
          variant="ghost"
          size="sm"
          motion="none"
          type="button"
          onClick={onDismiss}
          className="shrink-0"
        >
          <X className="icon-sm" strokeWidth={1.75} />
        </Button>
      </ButtonGroup>
    </section>
  );
}
