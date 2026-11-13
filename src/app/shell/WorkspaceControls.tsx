import { Button } from "../../shared/ui/Button";
import { Text } from "../../shared/ui/Text";
import { useT } from "../../shared/i18n";
import { EyeOff, GitPullRequest, RefreshCw, UsageIcon } from "../../shared/ui/icons";
import { FullscreenButton } from "./FullscreenButton";
import { SoundsButton } from "../../features/notifications/ui/SoundsButton";
import { surfaceAttributes } from "../../shared/ui/Surface";

export const WORKSPACE_REFRESH_EVENT = "bycoda:refresh-workspace-view";

/** The Usage glyph lives with the shared icons; this re-export keeps existing imports working. */
export { UsageIcon };

export function WorkspaceControls({
  onHiddenGroups,
  onPullRequests,
  onUsage,
  active,
  canRefresh = true,
}: {
  canRefresh?: boolean;
  onHiddenGroups: () => void;
  onPullRequests: () => void;
  onUsage: () => void;
  active?: "hiddenGroups" | "pullRequests" | "usage";
}) {
  const t = useT();
  const actions = [
    {
      id: "pullRequests",
      label: t("Pull requests"),
      icon: GitPullRequest,
      onClick: onPullRequests,
    },
    {
      id: "usage",
      label: t("Provider usage"),
      icon: UsageIcon,
      onClick: onUsage,
    },
    {
      id: "hiddenGroups",
      label: t("Manage hidden groups"),
      icon: EyeOff,
      onClick: onHiddenGroups,
    },
  ] as const;
  return (
    <Text
      as="nav"
      size="inherit"
      tone="secondary"
      aria-label={t("Workspace controls")}
      className="ml-auto flex shrink-0 items-center justify-end gap-1 px-2"
    >
      {actions.map(({ id, label, icon: Icon, onClick }) => (
        <Button
          iconOnly
          label={label}
          variant="ghost"
          motion="none"
          key={id}
          type="button"
          data-workspace-control={id}
          aria-pressed={active === id}
          onClick={onClick}
        >
          <Icon className="icon-sm" />
        </Button>
      ))}
      <span
        {...surfaceAttributes({ frame: "stroke", edge: "left" }, "mx-1 h-3")}
        aria-hidden="true"
      />
      <SoundsButton />
      <Button
        iconOnly
        label={t("Refresh current view")}
        variant="ghost"
        motion="none"
        type="button"
        disabled={!canRefresh}
        onClick={() => window.dispatchEvent(new Event(WORKSPACE_REFRESH_EVENT))}
      >
        <RefreshCw className="icon-sm" />
      </Button>
      <FullscreenButton />
    </Text>
  );
}
