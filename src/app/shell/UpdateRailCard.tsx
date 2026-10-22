import { Button } from "../../shared/ui/Button";
import { t, useLocale } from "../../shared/i18n";
import { X } from "../../shared/ui/icons";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import type { InstalledUpdate } from "../model/updateNotice";

type Props = {
  update: InstalledUpdate | null;
  onOpen: (version: string) => void;
  onDismiss: () => void;
};

export function UpdateRailCard({ update, onOpen, onDismiss }: Props) {
  useLocale();
  if (!update) return null;

  return (
    <section role="status" className="relative overflow-hidden rounded-lg bg-content/12">
      <Button
        variant="ghost"
        motion="none"
        type="button"
        onClick={() => onOpen(update.version)}
        className="flex w-full items-start gap-2"
      >
        <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center">
          <img
            src={PRODUCT_IDENTITY.logoSrc}
            alt=""
            aria-hidden
            className="size-4 object-contain"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium leading-tight text-content">
            {t("Updated to ")}
            {update.version}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-content/50">
            {t("What's new")}
          </span>
        </span>
      </Button>
      <Button
        iconOnly
        label={t("Dismiss update notification")}
        variant="ghost"
        motion="none"
        type="button"
        aria-label={t("Dismiss update notification")}
        onClick={onDismiss}
        className="absolute right-1 top-1 grid place-items-center"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </Button>
    </section>
  );
}
