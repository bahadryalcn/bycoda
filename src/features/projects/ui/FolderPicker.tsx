import { PickerListRoot } from "../../../shared/ui/picker/PickerList";
import {
  PICKER_WINDOW_THRESHOLD,
  usePickerWindow,
  type PickerWindowEntry,
} from "../../../shared/ui/picker/usePickerWindow";
import { surfaceAttributes } from "../../../shared/ui/Surface";
/** Different job: Folder navigation opens directories; its separate membership checkbox selects folders without navigating. */
import { Text } from "../../../shared/ui/Text";
import { RemoteActionError } from "../../connections/public/RemoteActionError";
import { describeRemoteError, type RemoteErrorView } from "../../connections/public/remoteFailure";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { useT } from "../../../shared/i18n";
import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties } from "react";
import {
  createPath,
  homeDir,
  listDir,
  openPathWithDefaultApp,
  pickNativeFolders,
  type FsEntry,
} from "../../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { probeWindowsDriveRoots } from "../model/windowsDriveRoots";
import { parentPath, pathKey, prettyCwd, slash } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import { ArrowLeft, Check, Folder, FolderOpen, FolderPlus } from "../../../shared/ui/icons";

type Props = {
  title: string;
  multiple: boolean;
  onPick: (paths: string[]) => void;
  onClose: () => void;
};

async function settleAction(
  action: () => Promise<void>,
  mounted: { current: boolean },
  setError: (error: RemoteErrorView) => void,
  setBusy: (busy: boolean) => void,
) {
  try {
    await action();
  } catch (reason) {
    if (mounted.current) setError(describeRemoteError(reason));
  } finally {
    if (mounted.current) setBusy(false);
  }
}

export function FolderPicker({ title, multiple, onPick, onClose }: Props) {
  const t = useT();
  const keyboardHelpId = useId();
  const [directory, setDirectory] = useState("");
  const [home, setHome] = useState("");
  const [roots, setRoots] = useState<string[]>(IS_WIN ? [] : ["/"]);
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [query, setQuery] = useState("");
  // The query is lower-cased once, outside the filter, instead of once per entry.
  const needle = query.trim().toLocaleLowerCase();
  const visibleEntries = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RemoteErrorView>();
  const [loadFailed, setLoadFailed] = useState(false);
  // A machine connection failure while listing is explained once by the central notice; the gate
  // classifies the raw text, not the presented sentence.
  const loadShownCentrally = useConnectionErrorShownCentrally(
    loadFailed ? error?.details : undefined,
  );
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [homeRevision, setHomeRevision] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  // Long listings mount only the rows near the viewport (shared picker windowing).
  const windowed = visibleEntries.length > PICKER_WINDOW_THRESHOLD;
  const rowEntries: PickerWindowEntry[] = visibleEntries.map((entry, index) => ({
    kind: "option",
    key: entry.path,
    index,
  }));
  const win = usePickerWindow(rowEntries, () => listRef.current, windowed);
  const managerLabel = IS_MAC
    ? t("Open in Finder")
    : IS_WIN
      ? t("Open in File Explorer")
      : t("Open in File Manager");
  const parent = directory ? parentPath(directory) : "";

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Initializes the mounted picker's OS home/drive snapshot and cancels late native replies on unmount.
  useEffect(() => {
    mounted.current = true;
    if (IS_WIN) void probeWindowsDriveRoots(() => mounted.current, setRoots).catch(() => {});
    setLoading(true);
    setError(undefined);
    void homeDir().then(
      (path) => {
        if (!mounted.current) return;
        setHome(slash(path));
        setDirectory(slash(path));
        setPathInput(slash(path));
      },
      (reason) => {
        if (mounted.current) {
          setError(describeRemoteError(reason));
          setLoadFailed(true);
          setLoading(false);
        }
      },
    );
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [homeRevision]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the open directory's filesystem snapshot and list focus synchronized with native navigation and refresh.
  useEffect(() => {
    if (!directory) return;
    const id = ++request.current;
    setLoading(true);
    setError(undefined);
    setLoadFailed(false);
    // The previous listing stays mounted (dimmed) until the next one resolves, so the list keeps its place.
    setActive(0);
    void listDir(directory).then(
      (items) => {
        if (id !== request.current || !mounted.current) return;
        setEntries(items.filter((entry) => entry.isDir));
        setLoading(false);
        listRef.current?.focus();
      },
      (reason) => {
        if (id !== request.current || !mounted.current) return;
        // A failed listing must not leave the previous folder's rows choosable.
        setEntries([]);
        setError(describeRemoteError(reason));
        setLoadFailed(true);
        setLoading(false);
      },
    );
  }, [directory, revision]);

  const scrollActiveIntoView = useEffectEvent((index: number) => {
    if (windowed) win.scrollToEntry(index);
    else
      listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the keyboard option visible when the active index changes.
  useEffect(() => {
    scrollActiveIntoView(active);
  }, [active]);

  function navigate(path: string) {
    if (busy) return;
    setDirectory(path);
    setQuery("");
    setPathInput(path);
    setNewName(null);
    setError(undefined);
  }

  function toggleSelected(path: string) {
    setSelected((paths) =>
      paths.some((item) => pathKey(item) === pathKey(path))
        ? paths.filter((item) => pathKey(item) !== pathKey(path))
        : [...paths, path],
    );
  }

  function pick() {
    if (busy || loading || !directory || loadFailed) return;
    onPick(selected.length ? selected : [directory]);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    await settleAction(action, mounted, setError, setBusy);
  }

  async function createFolder() {
    const name = newName?.trim();
    if (!name || /[/\\]/.test(name) || name === "." || name === "..") {
      setError({ message: t("Enter a folder name without path separators."), details: "" });
      return;
    }
    await run(async () => {
      const created = await createPath(directory, name, true);
      if (!mounted.current) return;
      setNewName(null);
      setDirectory(created);
      setPathInput(created);
    });
  }

  // A folder is a plain option with no nested controls. In a multi-select list a click toggles the
  // folder and a double click opens it; Enter opens it from the keyboard.
  function renderEntry(entry: FsEntry, index: number, measured: boolean) {
    const chosen = multiple && selected.some((path) => pathKey(path) === pathKey(entry.path));
    const measure = measured ? { ref: win.measureElement, "data-index": index } : {};
    return (
      <ActionHost
        key={entry.path}
        {...measure}
        id={`folder-picker-${index}`}
        role="option"
        selected={index === active}
        data-active={index === active}
        aria-selected={multiple ? chosen : index === active}
        aria-setsize={measured ? visibleEntries.length : undefined}
        aria-posinset={measured ? index + 1 : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (busy || loading) return;
          if (multiple) toggleSelected(entry.path);
          else navigate(entry.path);
        }}
        onDoubleClick={() => {
          if (multiple && !busy && !loading) navigate(entry.path);
        }}
        className="flex min-w-0 items-center gap-2 text-start"
      >
        {multiple ? (
          <span
            aria-hidden
            data-checked={chosen || undefined}
            className="flex icon-md shrink-0 items-center justify-center"
          >
            {chosen ? <Check className="icon-sm" /> : null}
          </span>
        ) : null}
        <Folder tone="muted" className="icon-md shrink-0" />
        <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
          {entry.name}
        </Text>
      </ActionHost>
    );
  }

  const rows = windowed
    ? win.items.map((item) => {
        const entry = visibleEntries[item.index];
        return entry ? renderEntry(entry, item.index, true) : null;
      })
    : visibleEntries.map((entry, index) => renderEntry(entry, index, false));
  const lead = windowed ? (win.items[0]?.start ?? 0) : 0;
  const tail =
    windowed && win.items.length ? win.totalSize - win.items[win.items.length - 1]!.end : 0;

  return (
    <Modal padding="none" scroll="none" title={title} onClose={onClose} minimalHeader size="md">
      <FieldGroup
        variant="bare"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (newName === null) pick();
          }
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            {...surfaceAttributes(
              { frame: "pane", edge: "bottom" },
              "flex shrink-0 items-center gap-2 p-3 pe-12",
            )}
          >
            <Button
              variant="secondary"
              motion="none"
              type="button"
              aria-label={t("Parent folder")}
              tooltip={t("Parent folder")}
              shortcut="Backspace"
              disabled={busy || !directory || pathKey(parent) === pathKey(directory)}
              onClick={() => navigate(parent)}
            >
              <ArrowLeft className="icon-md" />
            </Button>
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                let path = slash(pathInput.trim());
                if (path === "~") path = home;
                else if (path.startsWith("~/")) path = `${home}/${path.slice(2)}`;
                if (path) {
                  navigate(path);
                  setRevision((value) => value + 1);
                }
              }}
            >
              <TextField
                hideLabel
                label=""
                aria-label={t("Folder path")}

                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                placeholder={t("Folder path…")}
                disabled={busy}
                className="w-full"
              />
            </form>
            <Button
              variant="secondary"
              motion="none"
              type="button"
              shortcut="Mod+Enter"
              disabled={busy || loading || !directory || loadFailed}
              onClick={pick}
            >
              {t("Add")}
              {selected.length ? ` (${selected.length})` : ""}
            </Button>
          </div>
          <nav
            aria-label={t("Locations")}
            {...surfaceAttributes(
              { frame: "pane", edge: "bottom" },
              "flex shrink-0 flex-wrap gap-1 px-3 py-2",
            )}
          >
            <Button
              variant="secondary"
              motion="none"
              type="button"
              disabled={busy || !home}
              onClick={() => navigate(home)}
            >
              {t("Home folder")}
            </Button>
            {roots.map((path) => (
              <Button
                variant="secondary"
                motion="none"
                key={path}
                type="button"
                disabled={busy}
                aria-current={pathKey(path) === pathKey(directory) ? "location" : undefined}
                onClick={() => navigate(path)}
              >
                {path}
              </Button>
            ))}
          </nav>
          <div className="shrink-0 px-3 py-2">
            <SearchInput
              standalone
              aria-label={t("Search folders")}
              placeholder={t("Search folders")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          </div>
          <Text id={keyboardHelpId} className="sr-only">
            {t("↑ ↓ Navigate · Enter Open folder · Backspace Parent folder · Esc Close")}
          </Text>
          <div className="flex h-[min(340px,50dvh)] min-h-0 shrink flex-col px-3 py-2">
            {loading ? (
              <LoadingText inset="row" className="shrink-0">{t("Loading folders…")}</LoadingText>
            ) : visibleEntries.length === 0 && !error ? (
              <EmptyState
                size="inline"
                inset="row" className="shrink-0"
                description={t("No subfolders")}
              />
            ) : null}
            <PickerListRoot
              ref={listRef}
              label={t("Folders")}
              aria-describedby={keyboardHelpId}
              aria-busy={loading || undefined}
              multiple={multiple}
              tabIndex={0}
              aria-activedescendant={visibleEntries[active] ? `folder-picker-${active}` : undefined}
              className={
                loading
                  ? "min-h-0 flex-1 overflow-y-auto overscroll-none opacity-60"
                  : "min-h-0 flex-1 overflow-y-auto overscroll-none"
              }
              onKeyDown={(event) => {
                if (busy || loading) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) =>
                    Math.max(
                      0,
                      Math.min(
                        visibleEntries.length - 1,
                        index + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
                } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
                  event.preventDefault();
                  if (visibleEntries[active]) navigate(visibleEntries[active].path);
                } else if (event.key === "Backspace") {
                  event.preventDefault();
                  navigate(parent);
                } else if (event.key === " " && multiple && visibleEntries[active]) {
                  event.preventDefault();
                  toggleSelected(visibleEntries[active].path);
                }
              }}
            >
              {lead > 0 ? (
                <div
                  aria-hidden
                  className="[block-size:var(--folder-spacer-size)]"
                  style={{ "--folder-spacer-size": `${lead}px` } as CSSProperties}
                />
              ) : null}
              {rows}
              {tail > 0 ? (
                <div
                  aria-hidden
                  className="[block-size:var(--folder-spacer-size)]"
                  style={{ "--folder-spacer-size": `${tail}px` } as CSSProperties}
                />
              ) : null}
            </PickerListRoot>
          </div>
          {newName !== null ? (
            <form
              {...surfaceAttributes(
                { frame: "pane", edge: "top" },
                "flex shrink-0 flex-wrap items-center gap-2 px-3 py-2",
              )}
              onSubmit={(event) => {
                event.preventDefault();
                void createFolder();
              }}
            >
              <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
                <FolderPlus tone="muted" className="icon-md shrink-0" />
                <TextField
                  hideLabel
                  label=""
                  autoFocus
                  aria-label={t("New folder name")}
                  placeholder={t("Folder name…")}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  disabled={busy}
                  className="min-w-0 flex-1"
                />
              </div>
              <Button variant="secondary" motion="none" type="submit" disabled={busy}>
                {t("Create")}
              </Button>
              <Button
                variant="secondary"
                motion="none"
                type="button"
                disabled={busy}
                onClick={() => {
                  setNewName(null);
                  setError(undefined);
                  listRef.current?.focus();
                }}
              >
                {t("Cancel")}
              </Button>
            </form>
          ) : null}
          {error && !loadShownCentrally ? (
            <div className="shrink-0 px-3 py-2">
              <RemoteActionError
                error={error}
                title={
                  loadFailed
                    ? t("Couldn’t open this folder")
                    : error.details
                      ? t("Couldn’t create the folder")
                      : undefined
                }
                action={
                  loadFailed
                    ? {
                        label: t("Try again"),
                        onClick: () =>
                          directory
                            ? setRevision((value) => value + 1)
                            : setHomeRevision((value) => value + 1),
                      }
                    : undefined
                }
              />
            </div>
          ) : null}
          <div
            {...surfaceAttributes(
              { frame: "pane", edge: "top" },
              "flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2",
            )}
          >
            <Button
              variant="secondary"
              motion="none"
              type="button"
              tooltip={t("Create a folder in the current directory")}
              disabled={busy || loading || !directory}
              onClick={() => {
                setNewName("");
                setError(undefined);
              }}
            >
              <FolderPlus className="icon-sm" />
              {t("New folder")}
            </Button>
            <Button
              variant="secondary"
              motion="none"
              type="button"
              tooltip={t("Choose a drive, network location or folders using the system picker")}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const paths = await pickNativeFolders(title, multiple);
                  if (paths.length && mounted.current) onPick(paths);
                })
              }
            >
              {t("Browse…")}
            </Button>
            <Button
              variant="secondary"
              motion="none"
              type="button"
              tooltip={managerLabel}
              tooltipDetails={[prettyCwd(directory)]}
              disabled={busy || loading || !directory}
              onClick={() => void run(() => openPathWithDefaultApp(directory))}
            >
              <FolderOpen className="icon-sm" />
              {managerLabel}
            </Button>
          </div>
        </div>
      </FieldGroup>
    </Modal>
  );
}
