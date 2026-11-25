import { Button } from "../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../shared/ui/ActionHost";
import { useT } from "../../shared/i18n";
import { BookOpen, X } from "../../shared/ui/icons";
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
  const label = t("What's new in {p0}", { p0: update.version });
  const open = () => onOpen(update.version);
  const dismissLabel = t("Dismiss update notification");

  if (inline) {
    return (
      <section
        role="status"
        className="relative flex shrink-0 pe-[calc(var(--ui-control-height-xs)/2+var(--space-1)/4)]"
      >
        <Button
          iconOnly
          variant="ghost"
          motion="none"
          label={label}
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
      <ActionHost className="flex min-w-0 items-center">
        <Button
          variant="item"
          motion="none"
          type="button"
          label={label}
          aria-haspopup="dialog"
          startIcon={<BookOpen className="icon-sm" strokeWidth={1.75} aria-hidden />}
          onClick={open}
          truncate
        >
          {label}
        </Button>
        <InlineAction
          reveal="interaction"
          label={dismissLabel}
          motion="none"
          type="button"
          onClick={onDismiss}
          className="shrink-0"
        >
          <X className="icon-sm" strokeWidth={1.75} />
        </InlineAction>
      </ActionHost>
    </section>
  );
}
