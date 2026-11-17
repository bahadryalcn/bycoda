import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import {
  type ExpandingButtonGroupItem,
  type ExpandingButtonGroupTriggerProps,
} from "../../../shared/ui/ButtonGroup";
import { useT } from "../../../shared/i18n";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  listExternalEditors,
  openInExternalEditor,
  revealPath,
  type ExternalEditor,
} from "../../../platform/tauri/fs";
import { IS_MAC } from "../../../platform/tauri/platform";
import { isLocalProject } from "../model/recents";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/public/ExplorerMenu";

import { Modal } from "../../../shared/ui/Modal";
import { ExternalEditorIcon } from "./ExternalEditorIcon";
import { ProjectActionDialog } from "./ProjectActionDialog";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { DevServerStart, DevServerStartResult } from "../../host-tools/devServerTypes";
import { hostFeatureRequest } from "../../connections/public/hostFeatureClient";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { shortcutMatches } from "../../settings/public/settings";
import { quickComposerShortcutLabel } from "../../quick-composer/model/quickComposerShortcut";
import {
  CodeBlock,
  FolderOpen,
  Globe,
  CheckList,
  MoreHorizontal,
  Play,
  Plus,
  Terminal,
  Wrench,
} from "../../../shared/ui/icons";
import {
  actionExpectedPort,
  loadProjectActions,
  saveProjectActions,
  projectActionShortcutError,
  PROJECT_ACTIONS_CHANGED,
  type ProjectAction,
} from "../model/projectActions";

const DevServersPanel = lazySurface(async () => ({
  default: (await import("../../host-tools/DevServersPanel")).DevServersPanel,
}));

const ICONS = {
  play: Play,
  terminal: Terminal,
  code: CodeBlock,
  globe: Globe,
  wrench: Wrench,
};
const emptyAction = (): ProjectAction => ({
  id: crypto.randomUUID(),
  name: "",
  icon: "play",
  command: "",
  url: "",
});
type ProjectQuickActionsProps = {
  cwd: string;
  actionsCwd?: string;
  onRun?: (action: ProjectAction) => void;
  shortcutsEnabled?: boolean;
  /** Frequent actions shown as header buttons, after the run action. */
  additionalItems?: readonly ExpandingButtonGroupItem[];
  /** Occasional actions listed in the "More actions" menu, above the project menus. Each needs `onSelect`. */
  overflowItems?: readonly ExpandingButtonGroupItem[];
  /** Structural control kept outside the action group, after a gap. */
  trailing?: ReactNode;
};

export function ProjectQuickActions(props: ProjectQuickActionsProps) {
  const { cwd, actionsCwd = cwd } = props;
  // Another project starts with closed menus, no draft or error, and no launch.
  return <ProjectQuickActionsFor key={JSON.stringify([cwd, actionsCwd])} {...props} />;
}

function ProjectQuickActionsFor({
  cwd,
  actionsCwd = cwd,
  onRun,
  shortcutsEnabled = true,
  additionalItems = [],
  overflowItems = [],
  trailing,
}: ProjectQuickActionsProps) {
  const t = useT();
  const [menu, setMenu] = useState<{
    kind: "open" | "actions" | "more";
    anchor: HTMLElement;
  } | null>(null);
  const [editors, setEditors] = useState<ExternalEditor[]>([]);
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState(() => loadProjectActions(actionsCwd));
  const [draft, setDraft] = useState<ProjectAction | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [launch, setLaunch] = useState<{
    input: DevServerStart;
    result?: DevServerStartResult;
    pending?: boolean;
  }>();
  const pendingLaunch = useRef(false);
  const launchGeneration = useRef(0);
  const local = isLocalProject(cwd);
  const moreTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const reload = () => setActions(loadProjectActions(actionsCwd));
    reload();
    window.addEventListener(PROJECT_ACTIONS_CHANGED, reload);
    window.addEventListener("storage", reload);
    return () => {
      launchGeneration.current++;
      window.removeEventListener(PROJECT_ACTIONS_CHANGED, reload);
      window.removeEventListener("storage", reload);
    };
  }, [cwd, actionsCwd]);

  useEffect(() => {
    if (menu?.kind !== "open") return;
    let active = true;
    setLoading(true);
    void listExternalEditors()
      .then((values) => {
        if (active) setEditors(values);
      })
      .catch((reason: unknown) => {
        if (active) {
          setEditors([]);
          setError(String(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [menu?.kind]);

  // The parent passes a new `onRun` as its own state changes (every streamed frame
  // for a session pane); a stable wrapper keeps `run` and the keyboard
  // listener below from being rebuilt for it.
  const onRunLatest = useStableCallback(onRun);
  const canRun = !!onRun;
  const run = useCallback(
    (action: ProjectAction) => {
      setMenu(null);
      setError("");
      if (action.devServer && action.command.trim()) {
        if (pendingLaunch.current) return;
        pendingLaunch.current = true;
        const revision = launchGeneration.current;
        const expectedPort = actionExpectedPort(action.url);
        const input = {
          name: action.name,
          command: action.command.trim(),
          cwd: parseRemotePath(cwd)?.hostPath ?? cwd,
          expectedPort,
        };
        setLaunch({ input, pending: true });
        void hostFeatureRequest<DevServerStartResult>(cwd, "dev.servers", "devServers.start", input)
          .then((result) => {
            if (revision === launchGeneration.current)
              setLaunch((current) => (current ? { input, result } : current));
          })
          .catch((reason: unknown) => {
            if (revision === launchGeneration.current) {
              setLaunch((current) => (current ? { input } : current));
              setError(String(reason));
            }
          })
          .finally(() => {
            if (revision === launchGeneration.current) pendingLaunch.current = false;
          });
        return;
      }
      if (action.command.trim()) onRunLatest?.(action);
      if (action.url.trim() && action.openUrlOnRun !== false)
        void openUrl(action.url.trim()).catch((reason: unknown) => setError(String(reason)));
    },
    [cwd, onRunLatest],
  );

  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || hasActiveOverlay()) return;
      const action = actions.find(
        (value) =>
          value.shortcut &&
          shortcutMatches(value.shortcut, event) &&
          !projectActionShortcutError(value.shortcut, actions, value.id),
      );
      if (!action || (action.command.trim() && !action.devServer && !canRun)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      run(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [actions, canRun, run, shortcutsEnabled]);

  const persist = (values: ProjectAction[], keepAdding = false) => {
    try {
      saveProjectActions(actionsCwd, values);
    } catch (reason) {
      setError(t("Could not save actions: {p0}", { p0: String(reason) }));
      return false;
    }
    setActions(values);
    if (!keepAdding) setDraft(null);
    setError("");
    return true;
  };
  const openItems: ExplorerMenuItem[] = [
    ...editors.map((editor) => ({
      kind: "item" as const,
      id: editor.id,
      label: editor.name,
      icon: <ExternalEditorIcon id={editor.id} />,
    })),
    ...(loading
      ? [
          {
            kind: "item" as const,
            id: "loading",
            label: t("Finding installed editors…"),
            disabled: true,
          },
        ]
      : []),
    { kind: "sep" },
    {
      kind: "item",
      id: "folder",
      label: IS_MAC ? "Finder" : "File Explorer",
      icon: <FolderOpen tone="warning" className="icon-md" />,
    },
  ];
  const actionItems: ExplorerMenuItem[] = [
    ...actions.map((action) => {
      const Icon = ICONS[action.icon];
      return {
        kind: "item" as const,
        id: action.id,
        label: action.name,
        description: action.command || action.url,
        shortcut: action.shortcut ? quickComposerShortcutLabel(action.shortcut) : undefined,
        icon: <Icon className="size-4" />,
        submenu: [
          {
            kind: "item" as const,
            id: `run:${action.id}`,
            label: t("Run action"),
            disabled: Boolean(action.command.trim() && !action.devServer && !onRun),
          },
          {
            kind: "item" as const,
            id: `edit:${action.id}`,
            label: t("Edit action"),
          },
        ],
      };
    }),
    ...(actions.length ? [{ kind: "sep" as const }] : []),
    {
      kind: "item",
      id: "add",
      label: t("Add action…"),
      icon: <Plus className="icon-md" />,
    },
  ];
  const selected = actions[0];
  const SelectedIcon = selected ? ICONS[selected.icon] : Play;
  const items: readonly ExpandingButtonGroupItem[] = [
    ...(selected
      ? [
          {
            id: "run-project-action",
            label: selected.name,
            shortcut: selected.shortcut ? quickComposerShortcutLabel(selected.shortcut) : undefined,
            ariaLabel: t("Run {p0}", { p0: selected.name }),
            tooltip: `${selected.name}\n${selected.command || selected.url}\n${cwd}`,
            icon: <SelectedIcon className="size-3.5" />,
            disabled:
              Boolean(selected.command.trim() && !selected.devServer && !onRun) ||
              !!launch?.pending,
            onSelect: () => run(selected),
          },
        ]
      : []),
    ...additionalItems,
    {
      id: "more-actions",
      label: t("More actions"),
      icon: <MoreHorizontal className="icon-sm" strokeWidth={1.75} />,
      render: (renderTrigger) =>
        renderTrigger({
          ref: moreTrigger,
          "aria-haspopup": "menu",
          "aria-expanded": menu != null,
          onSelect: () => {
            setError("");
            if (moreTrigger.current)
              setMenu(menu ? null : { kind: "more", anchor: moreTrigger.current });
          },
        }),
    },
  ];
  // The project menus open in place of this one, at the same trigger.
  const moreItems: ExplorerMenuItem[] = [
    ...overflowItems.map((item) => ({
      kind: "item" as const,
      id: `item:${item.id}`,
      label: item.label,
      icon: item.icon,
      shortcut: item.shortcut ?? undefined,
      disabled: item.disabled,
      checked: item.active || undefined,
    })),
    ...(overflowItems.length ? [{ kind: "sep" as const }] : []),
    {
      kind: "item",
      id: "menu:actions",
      label: t("Project actions"),
      icon: <CheckList className="icon-sm" />,
    },
    ...(local
      ? [
          {
            kind: "item" as const,
            id: "menu:open",
            label: t("Open project in"),
            icon: <FolderOpen className="icon-sm" />,
          },
        ]
      : []),
  ];
  const pickMore = (id: string) => {
    const anchor = menu?.anchor;
    if (id === "menu:actions" || id === "menu:open") {
      if (anchor) setMenu({ kind: id === "menu:open" ? "open" : "actions", anchor });
      return;
    }
    setMenu(null);
    const item = overflowItems.find((value) => `item:${value.id}` === id);
    void Promise.resolve()
      .then(() => item?.onSelect?.())
      .catch((reason: unknown) => setError(String(reason)));
  };
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      data-no-drag
      data-tauri-drag-region="false"
      // Portal menus still bubble through this React owner into the draggable header.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ProjectQuickActionButtons items={items} onError={setError} />
      {trailing ? <div className="ms-1 flex items-center">{trailing}</div> : null}
      {menu ? (
        <ExplorerMenu
          key={menu.kind}
          anchor={menu.anchor}
          ariaLabel={
            menu.kind === "open"
              ? t("Open project in")
              : menu.kind === "more"
                ? t("More actions")
                : t("Project actions")
          }
          items={menu.kind === "open" ? openItems : menu.kind === "more" ? moreItems : actionItems}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            if (menu.kind === "more") {
              pickMore(id);
            } else if (menu.kind === "open") {
              setMenu(null);
              void (id === "folder" ? revealPath(cwd) : openInExternalEditor(id, cwd)).catch(
                (reason: unknown) => setError(String(reason)),
              );
            } else if (id === "add") {
              setMenu(null);
              setEditing(false);
              setDraft(emptyAction());
            } else {
              const action = actions.find((value) => value.id === id.replace(/^(run|edit):/, ""));
              if (!action) return;
              if (id.startsWith("edit:")) {
                setMenu(null);
                setEditing(true);
                setDraft({ ...action });
              } else run(action);
            }
          }}
        />
      ) : null}
      {error && !draft && !launch ? (
        <Modal title={t("Project action failed")} onClose={() => setError("")} size="sm">
          <Alert tone="danger">{error}</Alert>
        </Modal>
      ) : null}
      {launch ? (
        <Modal
          padding="none"
          title={t("Development servers")}
          size="lg"
          onClose={() => {
            setLaunch(undefined);
            setError("");
          }}
        >
          <div className="host-tools host-tools-content">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <DevServersPanel cwd={cwd} launch={launch} />
          </div>
        </Modal>
      ) : null}
      {draft ? (
        <ProjectActionDialog
          key={draft.id}
          action={draft}
          actions={actions}
          cwd={cwd}
          editing={editing}
          error={error}
          onClose={() => {
            setDraft(null);
            setError("");
          }}
          onDelete={() => persist(actions.filter((action) => action.id !== draft.id))}
          onSave={(saved) =>
            persist(
              editing
                ? actions.map((action) => (action.id === saved.id ? saved : action))
                : [...actions, saved],
              !editing,
            )
          }
        />
      ) : null}
    </div>
  );
}

function ProjectQuickActionButtons({
  items,
  onError,
}: {
  items: readonly ExpandingButtonGroupItem[];
  onError: (message: string) => void;
}) {
  return items.map((item) => {
    const renderTrigger = (trigger: ExpandingButtonGroupTriggerProps = {}) => (
      <ProjectQuickActionTrigger key={item.id} {...trigger} item={item} onError={onError} />
    );
    return item.render ? item.render(renderTrigger) : renderTrigger();
  });
}

function ProjectQuickActionTrigger({
  item,
  onError,
  ref,
  ariaLabel,
  disabled,
  onSelect,
  ...props
}: ExpandingButtonGroupTriggerProps & {
  item: ExpandingButtonGroupItem;
  onError: (message: string) => void;
}) {
  return (
    <Button
      ref={ref}
      iconOnly
      label={ariaLabel ?? item.ariaLabel ?? item.label}
      tooltip={item.tooltip ?? item.label}
      shortcut={item.shortcut}
      variant="ghost"
      size="sm"
      motion="none"
      selected={item.active}
      tone={item.tone}
      disabled={disabled ?? item.disabled}
      aria-haspopup={props["aria-haspopup"]}
      aria-expanded={props["aria-expanded"]}
      data-tauri-drag-region="false"
      onClick={async () => {
        const select = onSelect ?? item.onSelect;
        if (!select) return;
        try {
          await select();
        } catch (reason) {
          onError(String(reason));
        }
      }}
      onContextMenu={
        item.onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              item.onOpenContextMenu?.(event.clientX, event.clientY);
            }
          : undefined
      }
      onKeyDown={
        item.onOpenContextMenu
          ? (event) => {
              if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              item.onOpenContextMenu?.(rect.left, rect.bottom);
            }
          : undefined
      }
    >
      {item.icon}
    </Button>
  );
}
