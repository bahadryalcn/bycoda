import { Button } from "../../shared/ui/Button";
import { ButtonGroup } from "../../shared/ui/ButtonGroup";
import { useT } from "../../shared/i18n";
import { X } from "../../shared/ui/icons";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import type { InstalledUpdate } from "../model/updateNotice";

type Props = {
  update: InstalledUpdate | null;
  onOpen: (version: string) => void;
  onDismiss: () => void;
};

export function UpdateRailCard({ update, onOpen, onDismiss }: Props) {
  const t = useT();
  if (!update) return null;

  return (
    <section role="status" className="min-w-0">
      <ButtonGroup aria-label={`${t("Updated to ")}${update.version}`}>
        <Button
          variant="item"
          motion="none"
          type="button"
          onClick={() => onOpen(update.version)}
          align="start"
          aria-label={`${t("Updated to ")}${update.version} — ${t("What's new")}`}
          className="min-w-0 flex-1"
        >
          <img
            src={PRODUCT_IDENTITY.logoSrc}
            alt=""
            aria-hidden
            className="size-4 shrink-0 object-contain"
          />
          <span className="min-w-0 truncate text-ui-caption font-medium text-content">
            {t("Updated to ")}
            {update.version}
          </span>
          <span className="shrink-0 text-ui-caption text-content @max-[240px]/rail:hidden">
            {t("What's new")}
          </span>
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
          <X className="size-3.5" strokeWidth={1.75} />
        </Button>
      </ButtonGroup>
    </section>
  );
}
