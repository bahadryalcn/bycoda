import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { t, useLocale } from "../../../shared/i18n";
import { Globe } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { useWorkspaceFeature } from "../../settings/model/workspaceFeatures";

export const SOCIAL_PANEL_EVENT = "bycoda:open-social-panel";
/** Compact access from the global navigation or a session's tool area. */
export function SocialShortcut({
  cwd,
  compact = false,
  rail = false,
  responsiveRail = false,
  active = false,
}: {
  cwd: string;
  active?: boolean;
  compact?: boolean;
  /** Matches the compact vertical rail's square actions. */
  rail?: boolean;
  /** Follows the resizable project rail's icon-only container breakpoint. */
  responsiveRail?: boolean;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const visible = useWorkspaceFeature("social");
  if (!visible && !active) return null;
  return (
    <Button
      disabled={socialLocked}
      variant={responsiveRail ? "item" : "ghost"}
      motion="none"
      {...(compact || rail ? { iconOnly: true, label: t("Social Media") } : { iconOnly: false })}
      title={t("Social Media")}
      aria-pressed={active}
      aria-label={t("Social Media")}
      onClick={() => window.dispatchEvent(new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd } }))}
    >
      <span
        className={`flex min-w-0 items-center gap-2 ${responsiveRail ? "w-full @max-[140px]/rail:justify-center" : ""}`}
      >
        <Globe className="size-4 shrink-0" aria-hidden />
        {compact || rail ? null : (
          <span className={`min-w-0 truncate ${responsiveRail ? "@max-[140px]/rail:hidden" : ""}`}>
            {t("Social Media")}
          </span>
        )}
      </span>
    </Button>
  );
}
