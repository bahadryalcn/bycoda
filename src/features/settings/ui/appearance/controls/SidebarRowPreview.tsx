import { t, useLocale } from "../../../../../shared/i18n";
import type { SessionListDensity } from "../../../../sessions/public/sessionListDisplay";
import "./InterfaceSections.css";

/** A single miniature sidebar row that follows the row density and the model/branch toggles. */
export function SidebarRowPreview({
  density,
  showModel,
  showBranch,
}: {
  density: SessionListDensity;
  showModel: boolean;
  showBranch: boolean;
}) {
  useLocale();
  const detailed = density === "detailed";
  const meta = density !== "compact" && (showBranch || showModel);
  return (
    <div className="sidebar-row-preview" data-density={density} aria-hidden="true">
      <div className="sidebar-row-preview-row" data-selected>
        {detailed ? <span className="sidebar-row-preview-project">{t("Project")}</span> : null}
        <span className="sidebar-row-preview-line">
          <span className="sidebar-row-preview-title">{t("Chat")}</span>
          {density === "compact" && showModel ? (
            <span className="sidebar-row-preview-model">{t("Model")}</span>
          ) : null}
        </span>
        {meta ? (
          <span className="sidebar-row-preview-line sidebar-row-preview-meta">
            <span>{showBranch ? "main" : ""}</span>
            {showModel ? <span>{t("Model")}</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
