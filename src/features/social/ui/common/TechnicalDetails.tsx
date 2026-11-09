import { useId, useState, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import "./common.css";

/** Collapsed area for ids, raw payloads and other technical detail. Closed by default. */
export function TechnicalDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="social-technical-details">
      <Button
        variant="link"
        size="sm"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        {t("Technical details")}
      </Button>
      {open ? (
        <div id={bodyId} className="social-technical-details-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
