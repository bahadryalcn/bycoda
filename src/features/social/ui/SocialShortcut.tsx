import { t, useLocale } from "../../../shared/i18n";
import { Globe } from "../../../shared/ui/icons";
import { useWorkspaceFeature } from "../../settings/model/workspaceFeatures";

export const SOCIAL_PANEL_EVENT = "bycoda:open-social-panel";
/** Compact access from the global navigation or a session's tool area. */
export function SocialShortcut({
  cwd,
  compact = false,
  rail = false,
  active = false,
}: {
  cwd: string;
  active?: boolean;
  compact?: boolean;
  /** Matches the compact vertical rail's square actions. */
  rail?: boolean;
}) {
  useLocale();
  const visible = useWorkspaceFeature("social");
  if (!visible && !active) return null;
  return (
    <>
      <button
        type="button"
        title={t("Social Media")}
        aria-pressed={active}
        aria-label={t("Social Media")}
        className={`flex shrink-0 items-center gap-1.5 rounded-md ${active ? "bg-active/12 text-active" : "text-content/65 hover:bg-content/8 hover:text-content"} focus-visible:outline ${rail ? "size-8 justify-center" : compact ? "size-7 justify-center" : "px-2 py-1 text-xs"}`}
        onClick={() =>
          window.dispatchEvent(new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd } }))
        }
      >
        <Globe className="size-3.5" aria-hidden />
        {compact || rail ? null : <span>{t("Social Media")}</span>}
      </button>
    </>
  );
}
