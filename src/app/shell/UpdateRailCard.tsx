import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { ButtonGroup } from "../../shared/ui/ButtonGroup";
import { useT } from "../../shared/i18n";
import { BookOpen, X } from "../../shared/ui/icons";
import { BrandMark } from "../../shared/ui/BrandMark";
import type { InstalledUpdate } from "../model/updateNotice";

type Props = {
  update: InstalledUpdate | null;
  onOpen: (version: string) => void;
  onDismiss: () => void;
  inline?: boolean;
};

export function UpdateRailCard({ update, onOpen, onDismiss, inline = false }: Props) {
  const t = useT();
  if (!update) return null;
  // The complete message is one translation key so translators can reorder the version.
  const updatedLabel = t("Updated to {p0}", { p0: update.version });
  const whatsNew = t("What's new");
  const open = () => onOpen(update.version);
  const dismissLabel = t("Dismiss update notification");

  if (inline) {
    return (
      <section
        role="status"
        className="relative flex shrink-0 pe-[calc(var(--ui-control-height-xs)/2+var(--space-1)/4)]"
      >
        <span className="sr-only">{updatedLabel}</span>
        <Button
          iconOnly
          variant="ghost"
          motion="none"
          label={whatsNew}
          tooltip={`${whatsNew} · ${updatedLabel}`}
          tooltipSide="top"
          aria-haspopup="dialog"
          onClick={open}
        >
          <BookOpen className="icon-md" aria-hidden />
        </Button>
        <Button
          iconOnly
          label={dismissLabel}
          variant="ghost"
          size="xs"
          motion="none"
          className="absolute end-0 inset-bs-[calc((var(--ui-control-height-compact)-var(--ui-control-height-xs)-var(--space-1))/2-var(--space-2))]"
          tooltipSide="top"
          onClick={onDismiss}
        >
          <X className="icon-xs relative -start-1" aria-hidden />
        </Button>
      </section>
    );
  }

  return (
    <section role="status" className="min-w-0">
      <ButtonGroup aria-label={updatedLabel}>
        <Button
          variant="item"
          motion="none"
          type="button"
          onClick={open}
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
            {whatsNew}
          </Text>
        </Button>
        <Button
          iconOnly
          label={dismissLabel}
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
