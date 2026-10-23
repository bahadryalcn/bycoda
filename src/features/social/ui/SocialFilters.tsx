import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SocialPanelActiveContext } from "./socialContext";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SlidersHorizontal } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";

/** Collection filters stay near search without occupying the collection itself. */
export function SocialFilters({
  activeCount = 0,
  onReset,
  children,
}: {
  activeCount?: number;
  onReset: () => void;
  children: ReactNode;
}) {
  useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = useContext(SocialPanelActiveContext);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="secondary"
        size="sm"
        iconOnly={!activeCount}
        label={t("Filters")}
        title={t("Filters")}
        aria-label={activeCount ? t("Filters · {p0} active", { p0: activeCount }) : t("Filters")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden="true" />
        {activeCount ? <span>{activeCount}</span> : null}
      </Button>
      {open && active ? (
        <Popover
          anchor={anchor}
          align="end"
          width={300}
          role="dialog"
          aria-label={t("Filters")}
          className="social-filter-panel"
          onDismiss={() => setOpen(false)}
        >
          <div className="social-filter-heading">
            <strong>{t("Filters")}</strong>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!activeCount}
              onClick={onReset}
            >
              {t("Reset")}
            </Button>
          </div>
          {children}
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            {t("Done")}
          </Button>
        </Popover>
      ) : null}
    </>
  );
}
