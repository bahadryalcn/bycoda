import { Alert } from "../../shared/ui/Alert";
import {
  Activity,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppWindow,
  DashboardSquare,
  Globe,
  Inbox,
  StickyNote,
  Server,
  Zap,
} from "../../shared/ui/icons";
import { t, useLocale } from "../../shared/i18n";
import { TOOL_IDS, type WorkspaceToolId } from "../model/toolWindows";
import { routeWindowDestination } from "../model/windowNavigation";
import { Button } from "../../shared/ui/Button";
import { useSshRunbookQueue } from "../../features/connections/model/sshRunbookQueue";
import "./toolNavigation.css";

// Retained panels own separate headers. Carry keyboard focus into the header
// revealed by switching tools, after the previous tablist becomes hidden.
let pendingKeyboardFocus: WorkspaceToolId | null = null;

export const ToolNavigationContext = createContext<{
  active: WorkspaceToolId | null;
  cwd: string;
  notesEnabled: boolean;
  grouped?: boolean;
  includeServers?: boolean;
  onSelect: (tool: WorkspaceToolId) => void;
} | null>(null);

export function ToolHeader({ children }: { children: ReactNode }) {
  const navigation = useContext(ToolNavigationContext);
  return navigation?.active ? <ToolNavigation /> : children;
}

const labels = {
  servers: "Servers",
  social: "Social Media",
  tasks: "Tasks",
  automations: "Automations",
  inbox: "Inbox",
  notes: "Notes",
};
const icons = {
  servers: Server,
  social: Globe,
  tasks: DashboardSquare,
  automations: Zap,
  inbox: Inbox,
  notes: StickyNote,
};

/** Mount on first visit, retain edits and selection, suspend effects while hidden. */
export function ToolPanel({
  active,
  children,
  keepEffects = false,
}: {
  active: boolean;
  children: ReactNode;
  keepEffects?: boolean;
}) {
  const visited = useRef(false);
  if (active) visited.current = true;
  if (visited.current && keepEffects)
    return (
      <div
        className={active ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
        inert={!active ? true : undefined}
      >
        {children}
      </div>
    );
  return visited.current ? (
    <Activity mode={active ? "visible" : "hidden"}>{children}</Activity>
  ) : null;
}

export function ToolNavigation() {
  useLocale();
  const sshReviews = useSshRunbookQueue();
  const navigation = useContext(ToolNavigationContext);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const tabRefs = useRef(new Map<WorkspaceToolId, HTMLButtonElement>());
  useLayoutEffect(() => {
    if (pendingKeyboardFocus && pendingKeyboardFocus === navigation?.active) {
      tabRefs.current.get(pendingKeyboardFocus)?.focus();
      pendingKeyboardFocus = null;
    }
  }, [navigation?.active]);
  if (!navigation?.active) return null;
  const tools: WorkspaceToolId[] =
    navigation.grouped === false
      ? [navigation.active]
      : [
          ...(navigation.includeServers || navigation.active === "servers"
            ? ["servers" as const]
            : []),
          ...TOOL_IDS.filter((id) => id !== "notes" || navigation.notesEnabled),
        ];
  const open = async (grouped: boolean) => {
    if (opening || (navigation.active === "servers" && !grouped)) return;
    // Servers stays in the workspace; start the combined window on its first tool.
    const active = navigation.active === "servers" ? TOOL_IDS[0] : navigation.active!;
    setOpening(true);
    setError("");
    try {
      if (
        await routeWindowDestination({
          kind: "tool",
          tool: active,
          cwd: navigation.cwd,
          grouped,
        })
      )
        return;
      await invoke("open_tool_window", { tool: active, cwd: navigation.cwd, grouped });
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
          const nextTool = tools[next];
          pendingKeyboardFocus = nextTool;
          // Revealing an existing native window may leave this workspace as-is.
          // Do not carry a stale keyboard request into a later unrelated visit.
          window.setTimeout(() => {
            if (pendingKeyboardFocus === nextTool) pendingKeyboardFocus = null;
          }, 1000);
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
              {tool === "servers" && sshReviews.intents.length ? (
                <span aria-label={t("Pending SSH reviews")}>{sshReviews.intents.length}</span>
              ) : null}
            </Button>
          );
        })}
      </div>
      <div className="tool-window-actions">
        {navigation.active !== "servers" ? (
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
        ) : null}
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
