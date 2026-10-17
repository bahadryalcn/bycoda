import { Alert } from "../../shared/ui/Alert";
import { Activity, createContext, useContext, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow, DashboardSquare, Globe, Inbox, StickyNote, Zap } from "../../shared/ui/icons";
import { t, useLocale } from "../../shared/i18n";
import { TOOL_IDS, type ToolId } from "../model/toolWindows";
import { routeWindowDestination } from "../model/windowNavigation";
import { Button } from "../../shared/ui/Button";
import "./toolNavigation.css";

export const ToolNavigationContext = createContext<{
  active: ToolId | null;
  cwd: string;
  notesEnabled: boolean;
  grouped?: boolean;
  onSelect: (tool: ToolId) => void;
} | null>(null);

export function ToolHeader({ children }: { children: ReactNode }) {
  const navigation = useContext(ToolNavigationContext);
  return navigation?.active ? <ToolNavigation /> : children;
}

const labels = {
  social: "Social Media",
  tasks: "Tasks",
  automations: "Automations",
  inbox: "Inbox",
  notes: "Notes",
};
const icons = {
  social: Globe,
  tasks: DashboardSquare,
  automations: Zap,
  inbox: Inbox,
  notes: StickyNote,
};

/** Mount on first visit, retain edits and selection, suspend effects while hidden. */
export function ToolPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const visited = useRef(false);
  if (active) visited.current = true;
  return visited.current ? (
    <Activity mode={active ? "visible" : "hidden"}>{children}</Activity>
  ) : null;
}

export function ToolNavigation() {
  useLocale();
  const navigation = useContext(ToolNavigationContext);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const tabRefs = useRef(new Map<ToolId, HTMLButtonElement>());
  if (!navigation?.active) return null;
  const tools =
    navigation.grouped === false
      ? [navigation.active]
      : TOOL_IDS.filter((id) => id !== "notes" || navigation.notesEnabled);
  const open = async (grouped: boolean) => {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      if (
        await routeWindowDestination({
          kind: "tool",
          tool: navigation.active!,
          cwd: navigation.cwd,
          grouped,
        })
      )
        return;
      await invoke("open_tool_window", { tool: navigation.active, cwd: navigation.cwd, grouped });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="tool-navigation" data-tauri-drag-region="deep">
      <div
        className="tool-tabs"
        role="tablist"
        aria-label={t("Workspace tools")}
        onKeyDown={(event) => {
          const index = tools.indexOf(navigation.active!);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % tools.length
              : event.key === "ArrowLeft"
                ? (index + tools.length - 1) % tools.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tools.length - 1
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          navigation.onSelect(tools[next]);
          tabRefs.current.get(tools[next])?.focus();
        }}
      >
        {tools.map((tool) => {
          const Icon = icons[tool];
          return (
            <Button
              variant="tab"
              motion="none"
              key={tool}
              type="button"
              role="tab"
              data-tauri-drag-region="false"
              ref={(node) => {
                if (node) tabRefs.current.set(tool, node);
                else tabRefs.current.delete(tool);
              }}
              aria-selected={navigation.active === tool}
              tabIndex={navigation.active === tool ? 0 : -1}
              title={t(labels[tool])}
              onClick={() => navigation.onSelect(tool)}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span>{t(labels[tool])}</span>
            </Button>
          );
        })}
      </div>
      <div className="tool-window-actions">
        <Button
          variant="ghost"
          motion="none"
          iconOnly
          label={t("Open in new window")}
          data-tauri-drag-region="false"
          disabled={opening}
          onClick={() => void open(false)}
          aria-label={t("Open in new window")}
          title={t("Open in new window")}
        >
          <AppWindow className="size-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          motion="none"
          data-tauri-drag-region="false"
          disabled={opening}
          onClick={() => void open(true)}
          aria-label={t("Open all tools in one window")}
          title={t("Open all tools in one window")}
        >
          <DashboardSquare className="size-3.5" aria-hidden />
          <span className="tool-action-label">
            {opening ? t("Opening new window…") : t("All tools in one window")}
          </span>
        </Button>
      </div>
      {error ? (
        <Alert tone="danger" role="alert" data-tauri-drag-region="false">
          <span>
            {t("Could not open window")}: {error}
          </span>
          <Button variant="ghost" motion="none" onClick={() => setError("")}>
            {t("Dismiss")}
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
