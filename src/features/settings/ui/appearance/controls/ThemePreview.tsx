import { PRODUCT_IDENTITY } from "../../../../../shared/lib/productIdentity";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import "./ThemeControls.css";

/**
 * A live sample of the current theme drawn as a small app window. Each sidebar row shows one
 * interaction state with the real `--ui-surface-*` roles, so the preview follows palette, tint,
 * strength, mode and accent as they change. It is a picture: inert and hidden from assistive tech.
 */
export function ThemePreview() {
  useLocale();
  const rows: { state: "rest" | "hover" | "selected" | "pressed"; label: string }[] = [
    { state: "rest", label: t("Rest") },
    { state: "hover", label: t("Hover") },
    { state: "selected", label: t("Selected") },
    { state: "pressed", label: t("Pressed") },
  ];
  return (
    <figure className="theme-preview" aria-hidden="true">
      <div className="theme-preview-side">
        <span className="theme-preview-cap">{t("Sessions")}</span>
        {rows.map((row) => (
          <span key={row.state} className="theme-preview-row" data-state={row.state}>
            {row.label}
          </span>
        ))}
      </div>
      <div className="theme-preview-main" inert>
        <p className="theme-preview-user">{t("Message")}</p>
        <p className="theme-preview-reply">
          {PRODUCT_IDENTITY.displayName} <mark>{t("Selection")}</mark>{" "}
          <span className="theme-preview-link">{t("Link")}</span>
        </p>
        <div className="theme-preview-composer">
          <span className="theme-preview-placeholder">{t("Write a message")}</span>
          <Button variant="primary" tone="accent" size="sm" tabIndex={-1}>
            {t("Send")}
          </Button>
        </div>
      </div>
    </figure>
  );
}
