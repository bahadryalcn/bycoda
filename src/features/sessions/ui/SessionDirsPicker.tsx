import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { PickerList, PopoverSearchHeader, usePickerList } from "../../../shared/ui/picker";
import { useT } from "../../../shared/i18n";
import { useRef, useState } from "react";
import { basename, pickFolders } from "../../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { Folder, Plus } from "../../../shared/ui/icons";
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
  choosingProject: boolean;
  sessionId: string;
  project: string;
  pickingRef: { current: boolean };
  setPicking: (picking: boolean) => void;
  setError: (message: string | undefined) => void;
  setOpen: (open: boolean) => void;
  changeProject: (path: string) => void;
};

/** The native folder dialog and what follows; outside the component so its `try` stays out of render code. */
async function pickSessionFolders({
  choosingProject,
  sessionId,
  project,
  pickingRef,
  setPicking,
  setError,
  setOpen,
  changeProject,
}: FolderPick): Promise<void> {
  try {
    const selected = await pickFolders(
      choosingProject ? "Choose session project" : "Add folders to this session",
      !choosingProject,
    );
    if (selected.length === 0) return;
    if (selected.some((path) => !isLocalProject(path))) {
      setError("Choose a local project folder rather than your home or drive root.");
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
    setError("Could not open the folder picker. Please try again.");
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
  const [error, setError] = useState<string>();
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
      : `${effective.length} folders`;
  const browserLabel = IS_MAC ? "Finder" : IS_WIN ? "Explorer" : "file manager";

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
    setError(undefined);
    await pickSessionFolders({
      choosingProject,
      sessionId,
      project,
      pickingRef,
      setPicking,
      setError,
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
      mode === "project"
        ? pathKey(path) === pathKey(project)
          ? t("Current")
          : undefined
        : pathKey(path) === pathKey(workingDirectory)
          ? t("Working folder")
          : undefined,
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
    <div ref={root} className="relative shrink-0">
      <Button
        variant="ghost"
        type="button"
        tooltip={effective.map(prettyCwd).join("\n")}
        aria-label={t("Folders for this session")}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!enabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) dismiss(true);
          else {
            setMode("folders");
            setQuery("");
            setError(undefined);
            setOpen(true);
          }
        }}
        className="max-w-40"
      >
        <Folder
          className="icon-sm shrink-0"
          tone={overridden ? "accent" : undefined}
          strokeWidth={1.75}
        />
        <Text data-session-dirs-label size="micro" tone="inherit" truncate className="min-w-0">
          {label}
        </Text>
      </Button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          minWidth={320}
          autoFocus
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="dialog"
          aria-label={
            mode === "project" ? t("Change session project") : t("Folders for this session")
          }
          tabIndex={-1}
          className="flex min-h-0 flex-col"
        >
          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5">
            <Text as="p" weight="medium">
              {mode === "project" ? t("Change project") : t("Folders for this session")}
            </Text>
            {onProjectChange ? (
              <Button
                variant="ghost"
                type="button"
                disabled={picking || !enabled}
                onClick={() => {
                  setMode(mode === "folders" ? "project" : "folders");
                  setQuery("");
                  setError(undefined);
                }}
              >
                {mode === "folders" ? t("Change project…") : t("Back")}
              </Button>
            ) : null}
          </div>
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
          <Button
            variant="ghost"
            type="button"
            disabled={picking || !enabled}
            onClick={() => void browse()}
            loading={picking}
            startIcon={<Plus className="icon-sm shrink-0" />}
            className="mt-1 text-left"
          >
            {picking ? t("Choosing folders…") : t("Choose from {p0}…", { p0: browserLabel })}
          </Button>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex items-center gap-2 px-2 pb-0.5 pt-1.5">
            <Text as="p" size="micro" tone="secondary" className="min-w-0 flex-1">
              {mode === "project"
                ? t("Existing conversations open a new session in the chosen project.")
                : overridden
                  ? t("Extra folders apply to this session from the next message.")
                  : t("Working folder included. Extra folders follow the project setting.")}
            </Text>
            {overridden && mode === "folders" ? (
              <Button
                variant="ghost"
                type="button"
                disabled={picking || !enabled}
                onClick={() => saveSessionAdditionalDirs(sessionId, project, null)}
                className="shrink-0"
              >
                {t("Reset")}
              </Button>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
