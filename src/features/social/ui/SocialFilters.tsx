import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SocialPanelActiveContext } from "./socialContext";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SlidersHorizontal } from "../../../shared/ui/icons";

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
        label="Filtreler"
        title="Filtreler"
        aria-label={activeCount ? `Filtreler · ${activeCount} etkin` : "Filtreler"}
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
          aria-label="Filtreler"
          className="social-filter-panel"
          onDismiss={() => setOpen(false)}
        >
          <div className="social-filter-heading">
            <strong>Filtreler</strong>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!activeCount}
              onClick={onReset}
            >
              Sıfırla
            </Button>
          </div>
          {children}
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Tamam
          </Button>
        </Popover>
      ) : null}
    </>
  );
}
