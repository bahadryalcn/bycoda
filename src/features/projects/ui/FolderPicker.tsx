import { Alert } from "../../../shared/ui/Alert";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import {
  createPath,
  homeDir,
  listDir,
  statFiles,
  openPathWithDefaultApp,
  pickNativeFolders,
  type FsEntry,
} from "../../../platform/tauri/fs";
import { IS_MAC, IS_WIN, MOD } from "../../../platform/tauri/platform";
import { parentPath, pathKey, prettyCwd, slash } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import { ArrowLeft, Folder, FolderOpen, FolderPlus } from "../../../shared/ui/icons";

type Props = {
  title: string;
  multiple: boolean;
  onPick: (paths: string[]) => void;
  onClose: () => void;
};

export function FolderPicker({ title, multiple, onPick, onClose }: Props) {
  useLocale();
  const [directory, setDirectory] = useState("");
  const [home, setHome] = useState("");
  const [roots, setRoots] = useState<string[]>(IS_WIN ? [] : ["/"]);
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [query, setQuery] = useState("");
  const visibleEntries = entries.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  const managerLabel = IS_MAC
    ? "Open in Finder"
    : IS_WIN
      ? "Open in File Explorer"
      : "Open in File Manager";
  const parent = directory ? parentPath(directory) : "";

  useEffect(() => {
    mounted.current = true;
    if (IS_WIN)
      void statFiles(Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:/`)).then(
        (items) => {
          if (mounted.current)
            setRoots(items.filter((item) => item.isDir).map((item) => item.path));
        },
        () => {},
      );
    void homeDir().then(
      (path) => {
        if (!mounted.current) return;
        setHome(slash(path));
        setDirectory(slash(path));
        setPathInput(slash(path));
      },
      (reason) => {
        if (mounted.current) {
          setError(String(reason));
          setLoadFailed(true);
          setLoading(false);
        }
      },
    );
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);

  useEffect(() => {
    if (!directory) return;
    const id = ++request.current;
    setLoading(true);
    setError(undefined);
    setLoadFailed(false);
    setEntries([]);
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
        setError(String(reason));
        setLoadFailed(true);
        setLoading(false);
      },
    );
  }, [directory, revision]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function navigate(path: string) {
    if (busy) return;
    setDirectory(path);
    setQuery("");
    setPathInput(path);
    setNewName(null);
    setError(undefined);
  }

  function pick() {
    if (busy || loading || !directory || loadFailed) return;
    onPick(selected.length ? selected : [directory]);
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function createFolder() {
    const name = newName?.trim();
    if (!name || /[/\\]/.test(name) || name === "." || name === "..") {
      setError("Enter a folder name without path separators.");
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

  return (
    <Modal title={title} onClose={onClose} minimalHeader size="md">
      <div
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (newName === null) pick();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-stroke p-3 pr-12">
          <Button
            variant="secondary"
            motion="none"
            type="button"
            aria-label={t("Parent folder")}
            title={t("Parent folder (Backspace)")}
            disabled={busy || !directory || pathKey(parent) === pathKey(directory)}
            onClick={() => navigate(parent)}
          >
            <ArrowLeft className="size-4" />
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
              title={directory}
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
            title={t("Add folder ({p0}Enter)", { p0: MOD })}
            disabled={busy || loading || !directory || loadFailed}
            onClick={pick}
          >
            {t("Add")}
            {selected.length ? ` (${selected.length})` : ""}
          </Button>
        </div>
        <nav
          aria-label={t("Locations")}
          className="flex flex-wrap gap-1 border-b border-stroke px-3 py-2"
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
        <div className="px-3 py-2">
          <SearchInput
            standalone
            aria-label={t("Search folders")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
        </div>
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("Folders")}
          aria-multiselectable={multiple || undefined}
          tabIndex={0}
          aria-activedescendant={visibleEntries[active] ? `folder-picker-${active}` : undefined}
          title={t("↑ ↓ Navigate · Enter Open folder · Backspace Parent folder · Esc Close")}
          className="h-[min(340px,50vh)] overflow-y-auto overscroll-none p-1.5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
          onKeyDown={(event) => {
            if (busy || loading) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(visibleEntries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
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
              const path = visibleEntries[active].path;
              setSelected((paths) =>
                paths.some((item) => pathKey(item) === pathKey(path))
                  ? paths.filter((item) => pathKey(item) !== pathKey(path))
                  : [...paths, path],
              );
            }
          }}
        >
          {loading ? (
            <p role="status" className="p-3 text-[13px] text-[var(--ui-text-muted)]">
              {t("Loading folders…")}
            </p>
          ) : visibleEntries.length === 0 && !error ? (
            <p className="p-3 text-[13px] text-[var(--ui-text-muted)]">{t("No subfolders")}</p>
          ) : null}
          {visibleEntries.map((entry, index) => (
            <div
              key={entry.path}
              id={`folder-picker-${index}`}
              role="option"
              data-active={index === active}
              aria-selected={
                multiple
                  ? selected.some((path) => pathKey(path) === pathKey(entry.path))
                  : index === active
              }
              className={`flex items-center rounded-md ${index === active ? "bg-selection" : "hover:bg-[var(--ui-surface-hover)]"}`}
            >
              {multiple ? (
                <Checkbox
                  aria-label={t("Select {p0}", { p0: entry.name })}
                  checked={selected.some((path) => pathKey(path) === pathKey(entry.path))}
                  onChange={(event) =>
                    setSelected((paths) =>
                      event.target.checked
                        ? [...paths, entry.path]
                        : paths.filter((path) => pathKey(path) !== pathKey(entry.path)),
                    )
                  }
                  className="ml-2 size-3.5"
                  disabled={busy}
                />
              ) : null}
              <Button
                variant="item"
                motion="none"
                type="button"
                tabIndex={-1}
                title={t("{p0}\nOpen folder (Enter)", { p0: entry.path })}
                disabled={busy}
                onMouseEnter={() => setActive(index)}
                onClick={() => navigate(entry.path)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Folder className="size-4 shrink-0 text-[var(--ui-text-muted)]" />
                <span className="truncate">{entry.name}</span>
              </Button>
            </div>
          ))}
        </div>
        {newName !== null ? (
          <form
            className="flex items-center gap-2 border-t border-stroke px-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <FolderPlus className="size-4 shrink-0 text-[var(--ui-text-muted)]" />
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
        {error ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <Alert tone="danger">{error}</Alert>
            <Button
              variant="secondary"
              motion="none"
              type="button"
              disabled={busy}
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-stroke px-2 py-2">
          <Button
            variant="secondary"
            motion="none"
            type="button"
            title={t("Create a folder in the current directory")}
            disabled={busy || loading || !directory}
            onClick={() => {
              setNewName("");
              setError(undefined);
            }}
          >
            <FolderPlus className="size-3.5" />
            {t("New folder")}
          </Button>
          <Button
            variant="secondary"
            motion="none"
            type="button"
            title={t("Choose a drive, network location or folders using the system picker")}
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
            title={`${managerLabel}\n${prettyCwd(directory)}`}
            disabled={busy || loading || !directory}
            onClick={() => void run(() => openPathWithDefaultApp(directory))}
          >
            <FolderOpen className="size-3.5" />
            {managerLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
