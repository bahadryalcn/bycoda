import { t, useLocale } from "../../shared/i18n";
import { GitPullRequest, RefreshCw, Settings } from "../../shared/ui/icons";
import { FullscreenButton } from "./FullscreenButton";

export const WORKSPACE_REFRESH_EVENT = "bycoda:refresh-workspace-view";

export function UsageIcon({ className }: { className?: string }) {
  useLocale();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 20V12M12 20V4M19 20V8" />
    </svg>
  );
}

export function WorkspaceControls({
  onSettings,
  onPullRequests,
  onUsage,
  active,
  canRefresh = true,
}: {
  canRefresh?: boolean;
  onSettings: () => void;
  onPullRequests: () => void;
  onUsage: () => void;
  active?: "settings" | "pullRequests" | "usage";
}) {
  useLocale();
  const actions = [
    {
      id: "settings",
      get label() {
        return t("Settings");
      },
      icon: Settings,
      onClick: onSettings,
    },
    {
      id: "pullRequests",
      get label() {
        return t("Pull requests");
      },
      icon: GitPullRequest,
      onClick: onPullRequests,
    },
    {
      id: "usage",
      get label() {
        return t("Usage");
      },
      icon: UsageIcon,
      onClick: onUsage,
    },
  ] as const;
  return (
    <nav
      aria-label={t("Workspace controls")}
      className="ml-auto flex h-7 shrink-0 items-center justify-end gap-1 px-2 text-content/50"
    >
      {actions.map(({ id, label, icon: Icon, onClick }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={active === id}
          onClick={onClick}
          className={`grid size-6 place-items-center rounded-md transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent ${active === id ? "bg-selection text-content" : ""}`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
      <span className="mx-1 h-3 border-l border-stroke" aria-hidden="true" />
      <button
        type="button"
        disabled={!canRefresh}
        title={t("Refresh current view")}
        aria-label={t("Refresh current view")}
        onClick={() => window.dispatchEvent(new Event(WORKSPACE_REFRESH_EVENT))}
        className="grid size-6 place-items-center rounded-md hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 disabled:cursor-default"
      >
        <RefreshCw className="size-3.5" />
      </button>
      <FullscreenButton />
    </nav>
  );
}
