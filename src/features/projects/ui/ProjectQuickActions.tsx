import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  listExternalEditors,
  openInExternalEditor,
  revealPath,
  type ExternalEditor,
} from "../../../platform/tauri/fs";
import { IS_MAC } from "../../../platform/tauri/platform";
import { isLocalProject } from "../model/recents";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { Modal } from "../../../shared/ui/Modal";
import { ExternalEditorIcon } from "./ExternalEditorIcon";
import { ProjectActionDialog } from "./ProjectActionDialog";
import { DevServersPanel } from "../../host-tools/DevServersPanel";
import type { DevServerStart, DevServerStartResult } from "../../host-tools/devServerTypes";
import { hostFeatureRequest } from "../../connections/model/hostFeatureClient";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { shortcutMatches } from "../../settings/model/settings";
import { quickComposerShortcutLabel } from "../../quick-composer/model/quickComposerShortcut";
import {
  CodeBlock,
  FolderOpen,
  Globe,
  Play,
  Plus,
  Terminal,
  Wrench,
} from "../../../shared/ui/icons";
import {
  loadProjectActions,
  saveProjectActions,
  projectActionShortcutError,
  PROJECT_ACTIONS_CHANGED,
  type ProjectAction,
} from "../model/projectActions";

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
export function ProjectQuickActions({
  cwd,
  actionsCwd = cwd,
  onRun,
  shortcutsEnabled = true,
}: {
  cwd: string;
  actionsCwd?: string;
  onRun?: (action: ProjectAction) => void;
  shortcutsEnabled?: boolean;
}) {
  useLocale();
  const [menu, setMenu] = useState<{
    kind: "open" | "actions";
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

  useEffect(() => {
    const reload = () => setActions(loadProjectActions(actionsCwd));
    reload();
    setMenu(null);
    setDraft(null);
    setError("");
    setLaunch(undefined);
    pendingLaunch.current = false;
    launchGeneration.current++;
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

  const run = useCallback(
    (action: ProjectAction) => {
      setMenu(null);
      setError("");
      if (action.devServer && action.command.trim()) {
        if (pendingLaunch.current) return;
        pendingLaunch.current = true;
        const revision = launchGeneration.current;
        let expectedPort: number | undefined;
        try {
          const url = new URL(action.url.trim());
          if (["http:", "https:"].includes(url.protocol) && url.port)
            expectedPort = Number(url.port);
        } catch {
          /* A URL is optional for managed commands. */
        }
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
      if (action.command.trim()) onRun?.(action);
      if (action.url.trim() && action.openUrlOnRun !== false)
        void openUrl(action.url.trim()).catch((reason: unknown) => setError(String(reason)));
    },
    [cwd, onRun],
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
      if (!action || (action.command.trim() && !action.devServer && !onRun)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      run(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [actions, onRun, run, shortcutsEnabled]);

  const persist = (values: ProjectAction[]) => {
    try {
      saveProjectActions(actionsCwd, values);
      setActions(values);
      setDraft(null);
      setError("");
    } catch (reason) {
      setError(`Could not save actions: ${String(reason)}`);
    }
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
            get label() {
              return t("Finding installed editors…");
            },
            disabled: true,
          },
        ]
      : []),
    { kind: "sep" },
    {
      kind: "item",
      id: "folder",
      label: IS_MAC ? "Finder" : "File Explorer",
      icon: <FolderOpen className="size-4 text-warning" />,
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
            get label() {
              return t("Run action");
            },
            disabled: Boolean(action.command.trim() && !action.devServer && !onRun),
          },
          {
            kind: "item" as const,
            id: `edit:${action.id}`,
            get label() {
              return t("Edit action");
            },
          },
        ],
      };
    }),
    ...(actions.length ? [{ kind: "sep" as const }] : []),
    {
      kind: "item",
      id: "add",
      get label() {
        return t("Add action…");
      },
      icon: <Plus className="size-4" />,
    },
  ];
  const selected = actions[0];
  const SelectedIcon = selected ? ICONS[selected.icon] : Play;
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      data-no-drag
      data-tauri-drag-region="false"
      // Portal menus still bubble through this React owner into the draggable header.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {selected ? (
        <Button
          variant="ghost"
          motion="none"
          title={`${selected.name}\n${selected.command || selected.url}\n${cwd}`}
          aria-label={t("Run {p0}", { p0: selected.name })}
          disabled={
            Boolean(selected.command.trim() && !selected.devServer && !onRun) || !!launch?.pending
          }
          onClick={() => run(selected)}
        >
          <SelectedIcon className="size-3.5 text-accent" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        motion="none"
        aria-label={t("Project actions")}
        title={`${t("Project actions")}\n${cwd}`}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === "actions"}
        onClick={(event) => {
          setError("");
          setMenu(
            menu?.kind === "actions" ? null : { kind: "actions", anchor: event.currentTarget },
          );
        }}
      >
        <Play className="size-3.5" />
      </Button>
      {local ? (
        <Button
          variant="ghost"
          motion="none"
          aria-label={t("Open project in")}
          title={`${t("Open project in")}\n${cwd}`}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "open"}
          onClick={(event) => {
            setError("");
            setMenu(menu?.kind === "open" ? null : { kind: "open", anchor: event.currentTarget });
          }}
        >
          <FolderOpen className="size-3.5" />
        </Button>
      ) : null}
      {menu ? (
        <ExplorerMenu
          anchor={menu.anchor}
          ariaLabel={menu.kind === "open" ? "Open project in" : "Project actions"}
          items={menu.kind === "open" ? openItems : actionItems}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            if (menu.kind === "open") {
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
            )
          }
        />
      ) : null}
    </div>
  );
}
