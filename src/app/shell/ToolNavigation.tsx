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
  Bot,
  DashboardSquare,
  Globe,
  Inbox,
  StickyNote,
  Server,
  Sparkles,
  Zap,
  Wrench,
  Terminal,
} from "../../shared/ui/icons";
import { useT } from "../../shared/i18n";
import { TOOL_IDS, type WorkspaceToolId } from "../model/toolWindows";
import { routeWindowDestination } from "../model/windowNavigation";
import { Button } from "../../shared/ui/Button";
import { ErrorDetails, fitsOneLine } from "../../shared/ui/ErrorDetails";
import { Tab, TabList, Tabs } from "../../shared/ui/Tabs";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { useSshRunbookQueue } from "../../features/connections/model/sshRunbookQueue";
import "./toolNavigation.css";
import { preloadToolSurface } from "../workspace/surfaces/lazySurfaces";
import { useAssistantIdentity } from "../../features/assistant/model/assistantClient";

// Retained panels own separate headers. Carry keyboard focus into the header
// revealed by switching tools, after the previous tablist becomes hidden.
let pendingKeyboardFocus: WorkspaceToolId | null = null;
let pendingPickerFocus = false;
function requestKeyboardFocus(tool: WorkspaceToolId, picker = false) {
  pendingKeyboardFocus = tool;
  pendingPickerFocus = picker;
  // Opening a separate window may leave the current navigation unchanged.
  window.setTimeout(() => {
    if (pendingKeyboardFocus === tool) pendingKeyboardFocus = null;
  }, 1000);
}
function clearKeyboardFocus() {
  pendingKeyboardFocus = null;
  pendingPickerFocus = false;
}

export const ToolNavigationContext = createContext<{
  history?: { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void };
  active: WorkspaceToolId | null;
  cwd: string;
  notesEnabled: boolean;
  grouped?: boolean;
  includeServers?: boolean;
  includeCrews?: boolean;
  includeAuxiliaryTools?: boolean;
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
  crews: "Crews",
  inbox: "Inbox",
  notes: "Notes",
  "conversation-tools": "Conversation tools",
  terminal: "Terminal",
  assistant: "Set up",
};
const icons = {
  servers: Server,
  social: Globe,
  tasks: DashboardSquare,
  automations: Zap,
  crews: Bot,
  inbox: Inbox,
  notes: StickyNote,
  "conversation-tools": Wrench,
  terminal: Terminal,
  assistant: Sparkles,
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
  // A hidden panel keeps the element it last showed: React skips an identical
  // element, so workspace renders do not re-render the hidden tool's tree.
  const shown = useRef(children);
  if (active) {
    visited.current = true;
    shown.current = children;
  }
  if (visited.current && keepEffects)
    return (
      <div
        className={active ? "ui-page-enter flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
        inert={!active ? true : undefined}
      >
        {children}
      </div>
    );
  return visited.current ? (
    <Activity mode={active ? "visible" : "hidden"}>
      <div className="ui-page-enter flex min-h-0 min-w-0 flex-1 flex-col">{shown.current}</div>
    </Activity>
  ) : null;
}

/** Opens the tool in its own window; resolves to the failure text, or null. Never rejects. */
async function openToolWindow(
  tool: WorkspaceToolId,
  cwd: string,
  grouped: boolean,
): Promise<string | null> {
  try {
    if (await routeWindowDestination({ kind: "tool", tool, cwd, grouped })) return null;
    await invoke("open_tool_window", { tool, cwd, grouped });
    return null;
  } catch (cause) {
    return String(cause);
  }
}

export function ToolNavigation() {
  const t = useT();
  const assistant = useAssistantIdentity();
  const label = (tool: WorkspaceToolId) =>
    tool === "assistant" ? assistant.room : t(labels[tool]);
  const sshReviews = useSshRunbookQueue();
  const navigation = useContext(ToolNavigationContext);
  const [opening, setOpening] = useState<"single" | "grouped" | null>(null);
  const openingRef = useRef(false);
  const [error, setError] = useState("");
  const tabRefs = useRef(new Map<WorkspaceToolId, HTMLButtonElement>());
  const pickerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (pendingKeyboardFocus && pendingKeyboardFocus === navigation?.active) {
      (pendingPickerFocus ? pickerRef.current : tabRefs.current.get(pendingKeyboardFocus))?.focus();
      clearKeyboardFocus();
    }
  }, [navigation?.active]);
  if (!navigation?.active) return null;
  const tools: WorkspaceToolId[] =
    navigation.grouped === false
      ? [navigation.active]
      : TOOL_IDS.filter((id) =>
          id === "notes"
            ? navigation.notesEnabled
            : id === "servers"
              ? navigation.includeServers || navigation.active === "servers"
              : id === "crews"
                ? navigation.includeCrews || navigation.active === "crews"
                : id === "terminal" || id === "conversation-tools" || id === "assistant"
                  ? navigation.includeAuxiliaryTools
                  : true,
        );
  const open = async (grouped: boolean) => {
    if (openingRef.current) return;
    const active = navigation.active!;
    openingRef.current = true;
    setOpening(grouped ? "grouped" : "single");
    setError("");
    const failure = await openToolWindow(active, navigation.cwd, grouped);
    if (failure !== null) setError(failure);
    openingRef.current = false;
    setOpening(null);
  };
  return (
    <div
      className="tool-navigation"
      data-tool-picker={tools.length > 1 || undefined}
      data-tauri-drag-region="deep"
    >
      {tools.length > 1 ? (
        <div className="tool-picker" data-tauri-drag-region="false">
          <SearchableSelect
            hideLabel
            label={t("Workspace tools")}
            value={navigation.active}
            options={tools.map((tool) => ({
              value: tool,
              label: label(tool),
              description:
                tool === "servers" && sshReviews.intents.length
                  ? t("Pending SSH reviews")
                  : undefined,
            }))}
            triggerProps={{ ref: pickerRef }}
            onChange={(value) => {
              const tool = tools.find((id) => id === value);
              if (!tool || tool === navigation.active) return;
              requestKeyboardFocus(tool, true);
              navigation.onSelect(tool);
            }}
          />
        </div>
      ) : null}
      <Tabs
        value={navigation.active ?? ""}
        panels="none"
        onValueChange={(value) => {
          const tool = tools.find((id) => id === value);
          if (!tool) return;
          requestKeyboardFocus(tool);
          navigation.onSelect(tool);
        }}
      >
        <TabList className="tool-tabs" label={t("Workspace tools")}>
          {tools.map((tool) => {
            const Icon = icons[tool];
            return (
              <Tab
                value={tool}
                key={tool}
                data-tauri-drag-region="false"
                ref={(node) => {
                  if (node) tabRefs.current.set(tool, node);
                  else tabRefs.current.delete(tool);
                }}
                onPointerEnter={() => preloadToolSurface(tool)}
                onFocus={() => preloadToolSurface(tool)}
              >
                <Icon className="icon-sm shrink-0" aria-hidden />
                <span>{label(tool)}</span>
                {tool === "servers" && sshReviews.intents.length ? (
                  <span aria-label={t("Pending SSH reviews")}>{sshReviews.intents.length}</span>
                ) : null}
              </Tab>
            );
          })}
        </TabList>
      </Tabs>
      {navigation.active === "crews" ? null : (
        <div className="tool-window-actions">
          <Button
            variant="ghost"
            motion="none"
            iconOnly
            label={t("Open in new window")}
            data-tauri-drag-region="false"
            disabled={opening !== null}
            loading={opening === "single"}
            onClick={() => void open(false)}
          >
            <AppWindow className="icon-sm" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            motion="none"
            data-tauri-drag-region="false"
            disabled={opening !== null}
            loading={opening === "grouped"}
            startIcon={<DashboardSquare className="icon-sm" aria-hidden />}
            onClick={() => void open(true)}
            aria-label={t("Open all tools in one window")}
            tooltip={t("All tools in one window")}
            tooltipWhen="overflow"
          >
            <span className="tool-action-label">{t("All tools in one window")}</span>
          </Button>
        </div>
      )}
      {error ? (
        <Alert tone="danger" data-tauri-drag-region="false">
          {fitsOneLine(error) ? (
            <span>
              {t("Could not open window")}: {error}
            </span>
          ) : (
            <>
              <span>{t("Could not open window")}</span>
              <ErrorDetails title={t("Could not open window")} detail={error} />
            </>
          )}
          <Button variant="ghost" motion="none" onClick={() => setError("")}>
            {t("Dismiss")}
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
