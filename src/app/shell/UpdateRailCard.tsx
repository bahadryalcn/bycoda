import { Button } from "../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../shared/ui/ActionHost";
import { useT } from "../../shared/i18n";
import { Sparkles, X } from "../../shared/ui/icons";
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

  return (
    <section role="status" className="min-w-0">
      <ActionHost className="flex min-w-0 items-center">
        <Button
          variant={inline ? "ghost" : "item"}
          motion="none"
          type="button"
          label={label}
          aria-haspopup="dialog"
          startIcon={<Sparkles className="icon-sm" strokeWidth={1.75} aria-hidden />}
          revealLabel={inline}
          onClick={open}
          truncate
        >
          {label}
        </Button>
        <InlineAction
          reveal="interaction"
          label={t("Dismiss update notification")}
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
