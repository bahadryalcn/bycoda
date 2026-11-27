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
import { useRef, useState, useSyncExternalStore } from "react";
import { basename, pickFolders } from "../../../platform/tauri/fs";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { Folder, Plus, RotateCcw } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { useRemoteMachines } from "../../connections/public/connections";
import { pickFolderOnMachine } from "../../connections/public/machineFolderPick";
import { parseRemotePath, useRemoteProjectsOn } from "../../connections/public/remoteProjects";
import {
  MAX_PROJECT_REPOSITORIES,
  additionalDirsForSession,
  addProjectFolder,
  loadAdditionalDirs,
  loadProjectRepositoryChoice,
  saveProjectRepositoryChoice,
  saveSessionAdditionalDirs,
  useSessionAdditionalDirs,
} from "../../projects/public/additionalDirs";
import {
  isLocalProject,
  loadRecents,
  subscribeProjectPathsChanged,
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
  /** Title of the native folder dialog. */
  title: string;
  /** Where the picked folders are kept: the session's folders, or the project's list in worktree mode. */
  target: { sessionId: string; project: string; worktreeMode: boolean };
  pickingRef: { current: boolean };
  setPicking: (picking: boolean) => void;
  setProblem: (message: string | undefined) => void;
  setOpen: (open: boolean) => void;
};

/** Records picked folders in the session, or in the project's own list when repositories are chosen. */
function appendPicked(target: FolderPick["target"], paths: readonly string[]): void {
  const { sessionId, project, worktreeMode } = target;
  if (!worktreeMode) {
    // Read again after the native dialog: another window may have changed the selection.
    saveSessionAdditionalDirs(sessionId, project, [
      ...additionalDirsForSession(sessionId, project),
      ...paths,
    ]);
    return;
  }
  for (const path of paths) addProjectFolder(project, path);
}

/** The native folder dialog and what follows; outside the component so its `try` stays out of render code. */
async function pickSessionFolders({
  t,
  title,
  target,
  pickingRef,
  setPicking,
  setProblem,
  setOpen,
}: FolderPick): Promise<void> {
  try {
    const selected = await pickFolders(title, true);
    if (selected.length === 0) return;
    if (selected.some((path) => !isLocalProject(path))) {
      setProblem(t("Choose a local project folder rather than your home or drive root."));
      setOpen(true);
      return;
    }
    appendPicked(target, selected);
    setOpen(true);
  } catch {
    setProblem(t("Could not open the folder picker. Please try again."));
    setOpen(true);
  } finally {
    pickingRef.current = false;
    setPicking(false);
  }
}

/** The folder browser of the session's machine; it registers the folder as a project there. */
async function pickRemoteSessionFolder({
  t,
  machineId,
  target,
  pickingRef,
  setPicking,
  setProblem,
  setOpen,
}: FolderPick & { machineId: string }): Promise<void> {
  try {
    const key = await pickFolderOnMachine({ kind: "remote", machineId });
    if (key) appendPicked(target, [key]);
    setOpen(true);
  } catch {
    setProblem(t("Could not open the folder picker. Please try again."));
    setOpen(true);
  } finally {
    pickingRef.current = false;
    setPicking(false);
  }
}

const DIR_PREFIX = "dir:";

/** Repositories in the label: all, none or a count of the project's folders. */
function repositoriesLabel(t: typeof Translate, chosen: number, total: number): string {
  if (total === 0) return t("Repositories");
  if (chosen === 0) return t("No repositories");
  if (chosen === total) return t("All repositories");
  return t("{p0} repositories", { p0: chosen });
}

/**
 * The session's folders chip. In a new worktree it lists the project's folders as repositories
 * (each gets its own worktree); otherwise it lists the other folders the session also works in.
 * @use Choosing the other folders a session works in, and adding folders to the project.
 * @avoid Choosing the project: SearchableProjectPicker. Plain selection: SearchableSelect.
 * @replaces Local folder option rows and search field.
 */
export function SessionDirsPicker({
  sessionId,
  project,
  workingDirectory = project,
  recents,
  worktreeMode = false,
  enabled = true,
  onClose,
}: {
  sessionId: string;
  project: string;
  workingDirectory?: string;
  recents?: readonly RecentProject[];
  /** A new worktree is chosen: the chip picks the repositories that each get one. */
  worktreeMode?: boolean;
  enabled?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const [problem, setProblem] = useState<string>();
  const disabledReason = enabled ? undefined : t("Folders cannot be changed right now.");
  const root = useRef<HTMLDivElement>(null);
  const { overridden, dirs, projectDirs } = useSessionAdditionalDirs(sessionId, project);
  // The remembered repository choice is stored beside the folder list and changes with it.
  const choiceText = useSyncExternalStore(
    subscribeProjectPathsChanged,
    () => JSON.stringify(loadProjectRepositoryChoice(project)),
    () => "[]",
  );
  const chosenRepos = JSON.parse(choiceText) as string[];
  const chosenKeys = new Set(chosenRepos.map(pathKey));
  const storedRecents = useRecents();
  // A session on another machine picks among that machine's projects and folders.
  const remoteOwner = parseRemotePath(project);
  const rememberedRemote = useRemoteProjectsOn(remoteOwner?.environmentId);
  const { machines } = useRemoteMachines(!!remoteOwner);
  const machineId = remoteOwner
    ? machines.find((machine) => machine.environmentId === remoteOwner.environmentId)?.id
    : undefined;
  const shown = (path: string) => parseRemotePath(path)?.hostPath ?? prettyCwd(path);
  const isFixed = (path: string) =>
    pathKey(path) === pathKey(project) || pathKey(path) === pathKey(workingDirectory);
  const extras = dirs.filter((path) => !isFixed(path));
  const extraKeys = new Set(extras.map(pathKey));
  const candidates = uniquePaths([
    project,
    ...extras,
    ...(remoteOwner
      ? rememberedRemote.map((remote) => remote.key)
      : candidatesFrom(project, projectDirs, recents ?? storedRecents)),
  ]);
  const needle = query.trim().toLocaleLowerCase();
  const matching = candidates.filter((path) => path.toLocaleLowerCase().includes(needle));
  const worktreeMatching = worktreeMode
    ? projectDirs.filter((path) => path.toLocaleLowerCase().includes(needle))
    : matching;
  const name = (path: string) => basename(shown(path)) || shown(path);
  const label = worktreeMode
    ? repositoriesLabel(t, chosenRepos.length, projectDirs.length)
    : extras.length > 0
      ? t("Also work in +{p0}", { p0: extras.length })
      : t("Also work in");

  const toggle = (path: string) => {
    if (worktreeMode) {
      if (chosenKeys.has(pathKey(path)))
        saveProjectRepositoryChoice(
          project,
          chosenRepos.filter((dir) => pathKey(dir) !== pathKey(path)),
        );
      else if (chosenRepos.length < MAX_PROJECT_REPOSITORIES)
        saveProjectRepositoryChoice(project, [...chosenRepos, path]);
      return;
    }
    const next = extraKeys.has(pathKey(path))
      ? extras.filter((dir) => pathKey(dir) !== pathKey(path))
      : [...extras, path];
    saveSessionAdditionalDirs(sessionId, project, next);
  };
  const selectRepositories = (all: boolean) =>
    saveProjectRepositoryChoice(project, all ? projectDirs.slice(0, MAX_PROJECT_REPOSITORIES) : []);
  const target = { sessionId, project, worktreeMode };
  const pickTitle = worktreeMode
    ? t("Add folders to this project")
    : t("Add folders to this session");

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onClose?.();
  };

  const browse = async () => {
    if (pickingRef.current || !enabled) return;
    pickingRef.current = true;
    setPicking(true);
    setProblem(undefined);
    if (remoteOwner) {
      await pickRemoteSessionFolder({
        t,
        title: pickTitle,
        target,
        machineId: machineId ?? "",
        pickingRef,
        setPicking,
        setProblem,
        setOpen,
      });
      return;
    }
    await pickSessionFolders({
      t,
      title: pickTitle,
      target,
      pickingRef,
      setPicking,
      setProblem,
      setOpen,
    });
  };

  const blocked = picking || !enabled;
  const rowText = (path: string) => ({
    title: name(path),
    description: (
      <Text size="micro" tone="inherit">
        {shown(path)}
      </Text>
    ),
    icon: <Folder className="icon-sm" />,
  });
  const listed = worktreeMatching;
  const options = listed
    .filter((path) => worktreeMode || !isFixed(path))
    .map((path) => ({
      ...rowText(path),
      value: DIR_PREFIX + pathKey(path),
      group: worktreeMode ? undefined : t("Also work in"),
      disabled:
        blocked ||
        (worktreeMode &&
          !chosenKeys.has(pathKey(path)) &&
          chosenRepos.length >= MAX_PROJECT_REPOSITORIES),
    }));
  const choose = (value: string) => {
    if (blocked) return;
    const path = listed.find((item) => DIR_PREFIX + pathKey(item) === value);
    if (path) toggle(path);
  };
  const list = usePickerList({
    options,
    resetKey: `${open}:${query}`,
    multiple: true as const,
    value: (worktreeMode ? chosenRepos : extras).map((path) => DIR_PREFIX + pathKey(path)),
    onChange: (_values: string[], option: { value: string }) => choose(option.value),
  });

  return (
    <div ref={root} className="relative min-w-0 max-w-40">
      <Button
        variant="chip"
        type="button"
        tooltip={(worktreeMode ? chosenRepos : [project, ...extras]).map(shown).join("\n")}
        aria-label={
          worktreeMode ? t("Repositories for this session") : t("Folders for this session")
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!enabled}
        disabledReason={disabledReason}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) dismiss(true);
          else {
            setQuery("");
            setProblem(undefined);
            setOpen(true);
          }
        }}
      >
        <Folder
          className="icon-sm shrink-0"
          tone={overridden && !worktreeMode ? "accent" : undefined}
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
            worktreeMode ? t("Repositories for this session") : t("Folders for this session")
          }
          className="flex min-h-0 flex-col"
        >
          {worktreeMode ? (
            <Text as="p" size="caption" tone="secondary" className="px-3 pt-2">
              {t("Each gets its own worktree on the session's branch")}
            </Text>
          ) : null}
          <PopoverSearchHeader
            type="search"
            label={t("Search folders")}
            placeholder={t("Search folders…")}
            value={query}
            onValueChange={setQuery}
            {...list.searchProps}
          />
          <PickerList
            label={
              worktreeMode ? t("Repositories for this session") : t("Folders for this session")
            }
            controller={list}
            density="sm"
            emptyLabel={t("No matching folders")}
            className="max-h-64"
          />
          {problem ? <Alert tone="danger">{problem}</Alert> : null}
          <PickerFooter align="start">
            {!remoteOwner || machineId ? (
              <Button
                variant="ghost"
                type="button"
                disabled={blocked}
                disabledReason={disabledReason}
                onClick={() => void browse()}
                loading={picking}
                startIcon={<Plus className="icon-sm" />}
              >
                {t("Add folder…")}
              </Button>
            ) : null}
            {worktreeMode ? (
              <>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={blocked || projectDirs.length === 0}
                  onClick={() => selectRepositories(true)}
                >
                  {t("Select all")}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={blocked || chosenRepos.length === 0}
                  onClick={() => selectRepositories(false)}
                >
                  {t("Select none")}
                </Button>
              </>
            ) : null}
            {overridden && !worktreeMode ? (
              <Button
                variant="ghost"
                iconOnly
                label={t("Reset")}
                type="button"
                disabled={blocked}
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
