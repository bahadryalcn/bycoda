import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useT } from "../../../shared/i18n";
import { useRef, useState, useSyncExternalStore } from "react";
import { basename, pickFolders } from "../../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { Folder, Plus } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  additionalDirsForSession,
  loadAdditionalDirs,
  loadSessionAdditionalDirs,
  saveSessionAdditionalDirs,
  subscribeSessionAdditionalDirs,
} from "../../projects/model/additionalDirs";
import { isLocalProject, loadRecents, type RecentProject } from "../../projects/model/recents";

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
  return uniquePaths([
    project,
    ...loadAdditionalDirs(project),
    ...recents.map((recent) => recent.path).filter(isLocalProject),
  ]);
}

/** The working folder is always included; extra folders are scoped to this session. */
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
  useSyncExternalStore(
    subscribeSessionAdditionalDirs,
    () => (loadSessionAdditionalDirs(sessionId) ?? ["\0default"]).join("\n"),
    () => "",
  );
  const overridden = loadSessionAdditionalDirs(sessionId) !== undefined;
  const extras = additionalDirsForSession(sessionId, project).filter(
    (path) => pathKey(path) !== pathKey(workingDirectory),
  );
  const effective = uniquePaths([workingDirectory, ...extras]);
  const effectiveKeys = new Set(effective.map(pathKey));
  const candidates = uniquePaths([
    workingDirectory,
    ...extras,
    ...sessionDirCandidates(project, recents),
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
  };

  return (
    <div ref={root} className="relative shrink-0">
      <Button
        variant="ghost"
        type="button"
        title={effective.map(prettyCwd).join("\n")}
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
          className={`size-3.5 shrink-0 ${overridden ? "text-(--ui-tone-accent-fg)" : ""}`}
          strokeWidth={1.75}
        />
        <span data-session-dirs-label className="min-w-0 truncate text-ui-micro">
          {label}
        </span>
      </Button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          width={320}
          autoFocus
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="dialog"
          aria-label={
            mode === "project" ? t("Change session project") : t("Folders for this session")
          }
          tabIndex={-1}
          className="flex min-h-0 flex-col p-1.5"
        >
          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5">
            <p className="text-(length:--ui-font-caption) font-medium text-(--ui-text-secondary)">
              {mode === "project" ? t("Change project") : t("Folders for this session")}
            </p>
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
          <SearchInput
            appearance="field"
            type="search"
            aria-label={t("Search projects and folders")}
            placeholder={t("Search projects and folders…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            containerClassName="mx-2 my-1"
          />
          <div className="min-h-0 max-h-64 shrink overflow-y-auto overscroll-contain">
            {matching.map((path) => {
              const working = pathKey(path) === pathKey(workingDirectory);
              const details = (
                <span className="flex min-w-0 flex-1 flex-col" title={path}>
                  <span className="truncate text-ui-secondary text-(--ui-tone-neutral-fg)">
                    {basename(path) || prettyCwd(path)}
                  </span>
                  <span className="truncate text-ui-micro text-(--ui-text-secondary)">
                    {prettyCwd(path)}
                  </span>
                </span>
              );
              return mode === "project" ? (
                <Button
                  fullWidth
                  variant="item"
                  key={pathKey(path)}
                  type="button"
                  disabled={picking || !enabled || pathKey(path) === pathKey(project)}
                  onClick={() => changeProject(path)}
                  className="w-full text-left"
                >
                  <Folder className="size-3.5 shrink-0" />
                  {details}
                  {pathKey(path) === pathKey(project) ? (
                    <span className="text-(length:--ui-font-caption) text-(--ui-text-secondary)">
                      {t("Current")}
                    </span>
                  ) : null}
                </Button>
              ) : (
                <label
                  key={pathKey(path)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-(--ui-surface-raised)"
                >
                  <Checkbox
                    checked={effectiveKeys.has(pathKey(path))}
                    disabled={working || picking || !enabled}
                    onChange={() => toggle(path)}
                  />
                  {details}
                  {working ? (
                    <span className="shrink-0 text-(length:--ui-font-caption) text-(--ui-text-secondary)">
                      {t("Working folder")}
                    </span>
                  ) : null}
                </label>
              );
            })}
            {matching.length === 0 ? (
              <p className="px-2 py-2 text-ui-caption text-(--ui-text-secondary)">
                {t("No matching folders")}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            type="button"
            disabled={picking || !enabled}
            onClick={() => void browse()}
            loading={picking}
            startIcon={<Plus className="size-3.5 shrink-0" />}
            className="mt-1 text-left"
          >
            {picking ? t("Choosing folders…") : t("Choose from {p0}…", { p0: browserLabel })}
          </Button>
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
          <div className="flex items-center gap-2 px-2 pb-0.5 pt-1.5">
            <p className="min-w-0 flex-1 text-ui-micro leading-4 text-(--ui-text-secondary)">
              {mode === "project"
                ? t("Existing conversations open a new session in the chosen project.")
                : overridden
                  ? t("Extra folders apply to this session from the next message.")
                  : t("Working folder included. Extra folders follow the project setting.")}
            </p>
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
