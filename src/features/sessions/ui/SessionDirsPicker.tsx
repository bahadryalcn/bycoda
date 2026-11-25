import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import {
  PickerFooter,
  PickerList,
  PopoverSearchHeader,
  usePickerList,
} from "../../../shared/ui/picker";
import { useT, type t as Translate } from "../../../shared/i18n";
import { useRef, useState } from "react";
import { basename, pickFolders } from "../../../platform/tauri/fs";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { Check, Folder, Home, Plus, RotateCcw } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  additionalDirsForSession,
  loadAdditionalDirs,
  saveSessionAdditionalDirs,
  useSessionAdditionalDirs,
} from "../../projects/public/additionalDirs";
import {
  isLocalProject,
  loadRecents,
  useRecents,
  type RecentProject,
} from "../../projects/public/recents";

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = pathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every local project is available, regardless of its rail group. */
export function sessionDirCandidates(
  project: string,
  recents: readonly RecentProject[] = loadRecents(),
): string[] {
  return candidatesFrom(project, loadAdditionalDirs(project), recents);
}

/** `sessionDirCandidates` over values already read (see `useSessionAdditionalDirs`, `useRecents`). */
function candidatesFrom(
  project: string,
  projectDirs: readonly string[],
  recents: readonly RecentProject[],
): string[] {
  return uniquePaths([
    project,
    ...projectDirs,
    ...recents.map((recent) => recent.path).filter(isLocalProject),
  ]);
}

type FolderPick = {
  t: typeof Translate;
  choosingProject: boolean;
  sessionId: string;
  project: string;
  pickingRef: { current: boolean };
  setPicking: (picking: boolean) => void;
  setProblem: (message: string | undefined) => void;
  setOpen: (open: boolean) => void;
  changeProject: (path: string) => void;
};

/** The native folder dialog and what follows; outside the component so its `try` stays out of render code. */
async function pickSessionFolders({
  t,
  choosingProject,
  sessionId,
  project,
  pickingRef,
  setPicking,
  setProblem,
  setOpen,
  changeProject,
}: FolderPick): Promise<void> {
  try {
    const selected = await pickFolders(
      choosingProject ? t("Choose session project") : t("Add folders to this session"),
      !choosingProject,
    );
    if (selected.length === 0) return;
    if (selected.some((path) => !isLocalProject(path))) {
      setProblem(t("Choose a local project folder rather than your home or drive root."));
      setOpen(true);
      return;
    }
    if (choosingProject) {
      changeProject(selected[0]!);
    } else {
      // Read again after the native dialog: another window may have changed the selection.
      saveSessionAdditionalDirs(sessionId, project, [
        ...additionalDirsForSession(sessionId, project),
        ...selected,
      ]);
      setOpen(true);
    }
  } catch {
    setProblem(t("Could not open the folder picker. Please try again."));
    setOpen(true);
  } finally {
    pickingRef.current = false;
    setPicking(false);
  }
}

/**
 * The working folder is always included; extra folders are scoped to this session.
 * @use Session-only folder selection plus native folder browsing, using shared picker primitives.
 * @avoid Plain project selection: SearchableSelect.
 * @replaces Local folder option rows and search field.
 */
export function SessionDirsPicker({
  sessionId,
  project,
  workingDirectory = project,
  recents,
  onProjectChange,
  enabled = true,
  onClose,
}: {
  sessionId: string;
  project: string;
  workingDirectory?: string;
  recents?: readonly RecentProject[];
  onProjectChange?: (path: string) => void;
  enabled?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"folders" | "project">("folders");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const [problem, setProblem] = useState<string>();
  const disabledReason = enabled ? undefined : t("Folders cannot be changed right now.");
  const root = useRef<HTMLDivElement>(null);
  const { overridden, dirs, projectDirs } = useSessionAdditionalDirs(sessionId, project);
  const storedRecents = useRecents();
  const extras = dirs.filter((path) => pathKey(path) !== pathKey(workingDirectory));
  const effective = uniquePaths([workingDirectory, ...extras]);
  const effectiveKeys = new Set(effective.map(pathKey));
  const candidates = uniquePaths([
    workingDirectory,
    ...extras,
    ...candidatesFrom(project, projectDirs, recents ?? storedRecents),
  ]);
  const needle = query.trim().toLocaleLowerCase();
  const matching = candidates.filter(
    (path) =>
      path.toLocaleLowerCase().includes(needle) &&
      (mode === "project" ||
        pathKey(path) !== pathKey(project) ||
        pathKey(path) === pathKey(workingDirectory)),
  );
  const label =
    effective.length === 1
      ? basename(workingDirectory) || prettyCwd(workingDirectory)
      : t("{p0} folders", { p0: effective.length });

  const toggle = (path: string) => {
    if (pathKey(path) === pathKey(workingDirectory)) return;
    const next = effectiveKeys.has(pathKey(path))
      ? extras.filter((dir) => pathKey(dir) !== pathKey(path))
      : [...extras, path];
    saveSessionAdditionalDirs(sessionId, project, next);
  };

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onClose?.();
  };

  const changeProject = (path: string) => {
    if (!enabled || !onProjectChange) return;
    dismiss(true);
    onProjectChange(path);
  };

  const browse = async () => {
    if (pickingRef.current || !enabled) return;
    pickingRef.current = true;
    const choosingProject = mode === "project";
    setPicking(true);
    setProblem(undefined);
    await pickSessionFolders({
      t,
      choosingProject,
      sessionId,
      project,
      pickingRef,
      setPicking,
      setProblem,
      setOpen,
      changeProject,
    });
  };

  const options = matching.map((path) => ({
    value: pathKey(path),
    title: basename(path) || prettyCwd(path),
    description: (
      <Text size="micro" tone="inherit">
        {prettyCwd(path)}
      </Text>
    ),
    icon: <Folder className="icon-sm" />,
    meta:
      mode === "project" ? (
        pathKey(path) === pathKey(project) ? (
          <Check className="icon-sm" role="img" aria-label={t("Current")} />
        ) : undefined
      ) : pathKey(path) === pathKey(workingDirectory) ? (
        <Home className="icon-sm" role="img" aria-label={t("Working folder")} />
      ) : undefined,
    disabled:
      picking ||
      !enabled ||
      pathKey(path) === pathKey(mode === "project" ? project : workingDirectory),
  }));
  const choose = (key: string) => {
    const path = matching.find((path) => pathKey(path) === key);
    if (!path || picking || !enabled) return;
    if (mode === "project") changeProject(path);
    else toggle(path);
  };
  const list = usePickerList({
    options,
    resetKey: `${open}:${mode}:${query}`,
    ...(mode === "folders"
      ? {
          multiple: true as const,
          value: [...effectiveKeys],
          onChange: (_values: string[], option: { value: string }) => choose(option.value),
        }
      : { value: pathKey(project), onChange: choose }),
  });

  return (
    <div ref={root} className="relative min-w-0 max-w-40">
      <Button
        variant="chip"
        type="button"
        tooltip={effective.map(prettyCwd).join("\n")}
        aria-label={t("Folders for this session")}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!enabled}
        disabledReason={disabledReason}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) dismiss(true);
          else {
            setMode("folders");
            setQuery("");
            setProblem(undefined);
            setOpen(true);
          }
        }}
      >
        <Folder
          className="icon-sm shrink-0"
          tone={overridden ? "accent" : undefined}
          strokeWidth={1.75}
        />
        <Text data-session-dirs-label size="inherit" tone="inherit" truncate>
          {label}
        </Text>
      </Button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          minWidth={320}
          onDismiss={(reason) => dismiss(reason === "escape")}
          kind="dialog"
          aria-label={
            mode === "project" ? t("Change session project") : t("Folders for this session")
          }
          className="flex min-h-0 flex-col"
        >
          <PopoverSearchHeader
            type="search"
            label={t("Search projects and folders")}
            placeholder={t("Search projects and folders…")}
            value={query}
            onValueChange={setQuery}
            {...list.searchProps}
          />
          <PickerList
            label={mode === "project" ? t("Change session project") : t("Folders for this session")}
            controller={list}
            density="sm"
            emptyLabel={t("No matching folders")}
            className="max-h-64"
          />
          {problem ? <Alert tone="danger">{problem}</Alert> : null}
          <PickerFooter align="start">
            {onProjectChange ? (
              <Button
                variant="ghost"
                type="button"
                disabled={picking || !enabled}
                disabledReason={disabledReason}
                tooltip={
                  mode === "folders"
                    ? t("Existing conversations open a new session in the chosen project.")
                    : undefined
                }
                onClick={() => {
                  setMode(mode === "folders" ? "project" : "folders");
                  setQuery("");
                  setProblem(undefined);
                }}
              >
                {mode === "folders" ? t("Change project…") : t("Back")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              type="button"
              disabled={picking || !enabled}
              disabledReason={disabledReason}
              onClick={() => void browse()}
              loading={picking}
              startIcon={<Plus className="icon-sm" />}
            >
              {mode === "project" ? t("Open a project") : t("Add folder…")}
            </Button>
            {overridden && mode === "folders" ? (
              <Button
                variant="ghost"
                iconOnly
                label={t("Reset")}
                type="button"
                disabled={picking || !enabled}
                disabledReason={disabledReason}
                onClick={() => saveSessionAdditionalDirs(sessionId, project, null)}
              >
                <RotateCcw className="icon-sm" />
              </Button>
            ) : null}
          </PickerFooter>
        </Popover>
      ) : null}
    </div>
  );
}
