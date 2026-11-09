import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { ContextMenu } from "../../../shared/ui/ContextMenu";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import {
  saveGitPanelSection,
  useGitPanelSections,
  type GitPanelSection,
} from "../model/panelSections";
import {
  GitHistoryGraph,
  GraphResizeSash,
  GRAPH_PANEL_DEFAULT,
  GRAPH_PANEL_MIN,
  loadGraphPanelHeight,
  saveGraphPanelHeight,
} from "./GitHistoryGraph";
import { GitStashSection } from "./GitStashSection";

// Session-wide disclosure memory. A grouped repository row starts with its
// graph folded so several repositories do not each open a tall history.
let graphOpen = true;
let repositoryGraphOpen = false;
// Rows of an overview have no fixed pane height to fit the graph into.
const REPOSITORY_GRAPH_MAX = GRAPH_PANEL_DEFAULT * 3;

/** Stashes and the commit graph below a repository's changes, each hideable from the panel menu. */
export function GitPanelSections({
  cwd,
  enabled,
  hasChanges,
  selectedSha,
  onOpenCommit,
  paneRef,
  repository = false,
}: {
  cwd: string;
  enabled: boolean;
  hasChanges: boolean;
  selectedSha?: string;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) => void;
  paneRef: RefObject<HTMLDivElement | null>;
  /** A row of the multi-repository overview, whose height follows its content. */
  repository?: boolean;
}) {
  const shown = useGitPanelSections();
  const [graphHeight, setGraphHeight] = useState(loadGraphPanelHeight);
  const [graphExpanded, setGraphExpanded] = useState(repository ? repositoryGraphOpen : graphOpen);
  // A drag paints the graph box directly; re-rendering the whole panel every
  // frame made the sash lag behind the pointer. State updates once, on release.
  const graphBoxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (repository) return;
    const pane = paneRef.current;
    if (!pane || pane.clientHeight < GRAPH_PANEL_MIN + 160) return;
    const max = pane.clientHeight - 160;
    if (graphHeight > max) {
      setGraphHeight(max);
      saveGraphPanelHeight(max);
    }
  }, [graphHeight, paneRef, repository]);

  return (
    <>
      {shown.stashes ? (
        <GitStashSection
          cwd={cwd}
          enabled={enabled}
          hasChanges={hasChanges}
          onOpenCommit={onOpenCommit}
        />
      ) : null}
      {shown.graph && graphExpanded ? (
        <GraphResizeSash
          height={graphHeight}
          onHeightPaint={(next) => {
            if (graphBoxRef.current) graphBoxRef.current.style.height = `${next}px`;
          }}
          onHeightCommit={(next) => {
            setGraphHeight(next);
            saveGraphPanelHeight(next);
          }}
          maxHeight={() => {
            const pane = paneRef.current;
            if (repository || !pane) return REPOSITORY_GRAPH_MAX;
            return Math.max(GRAPH_PANEL_MIN, pane.clientHeight - 160);
          }}
        />
      ) : null}
      {shown.graph ? (
        <div
          ref={graphBoxRef}
          className={`shrink-0 overflow-hidden border-t border-stroke ${
            graphExpanded ? "min-h-0" : "h-7"
          }`}
          // Cap the shown height, not the saved one, so a shorter window keeps the
          // file list visible and the chosen height returns when it grows again.
          style={
            graphExpanded
              ? {
                  height: graphHeight,
                  maxHeight: repository ? REPOSITORY_GRAPH_MAX : "calc(100% - 160px)",
                }
              : undefined
          }
        >
          <GitHistoryGraph
            cwd={cwd}
            enabled={enabled}
            expanded={graphExpanded}
            selectedSha={selectedSha}
            onToggleExpanded={() => {
              const next = !graphExpanded;
              if (repository) repositoryGraphOpen = next;
              else graphOpen = next;
              setGraphExpanded(next);
            }}
            onOpenCommit={onOpenCommit}
          />
        </div>
      ) : null}
    </>
  );
}

const SECTION_LABEL: Record<GitPanelSection, string> = { stashes: "Stashes", graph: "Graph" };

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
  );
}

/**
 * Right-click on the panel's own surface (not a file, stash or commit row, which
 * keep their menus) chooses the visible sections and panel preferences.
 */
export function usePanelPreferencesMenu({
  autoFetch,
  canFetch,
  onToggleAutoFetch,
}: {
  autoFetch: boolean;
  canFetch: boolean;
  onToggleAutoFetch: () => void;
}) {
  useLocale();
  const shown = useGitPanelSections();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || isEditable(event.target)) return;
    event.preventDefault();
    setPoint({ x: event.clientX, y: event.clientY });
  };
  const menu = point ? (
    <ContextMenu
      x={point.x}
      y={point.y}
      ariaLabel={t("Source control")}
      items={[
        ...(Object.keys(SECTION_LABEL) as GitPanelSection[]).map((section) => ({
          kind: "item" as const,
          id: section,
          label: t(SECTION_LABEL[section]),
          checked: shown[section],
        })),
        { kind: "sep" as const },
        {
          kind: "item" as const,
          id: "auto-fetch",
          label: t("Auto Fetch"),
          checked: autoFetch,
          disabled: !canFetch,
        },
      ]}
      onPick={(id) => {
        setPoint(null);
        if (id === "auto-fetch") onToggleAutoFetch();
        else if (id in SECTION_LABEL)
          saveGitPanelSection(id as GitPanelSection, !shown[id as GitPanelSection]);
      }}
      onClose={() => setPoint(null)}
    />
  ) : null;
  return { onContextMenu, menu };
}
