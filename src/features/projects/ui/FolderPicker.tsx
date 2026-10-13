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

const actionClass =
  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-content/65 hover:bg-content/5 hover:text-content disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function FolderPicker({ title, multiple, onPick, onClose }: Props) {
  useLocale();
  const [directory, setDirectory] = useState("");
  const [home, setHome] = useState("");
  const [roots, setRoots] = useState<string[]>(IS_WIN ? [] : ["/"]);
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
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
          <button
            type="button"
            aria-label={t("Parent folder")}
            title={t("Parent folder (Backspace)")}
            disabled={busy || !directory || pathKey(parent) === pathKey(directory)}
            className={actionClass}
            onClick={() => navigate(parent)}
          >
            <ArrowLeft className="size-4" />
          </button>
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
            <input
              aria-label={t("Folder path")}
              title={directory}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder={t("Folder path…")}
              disabled={busy}
              className="w-full rounded-md bg-transparent px-1 py-1.5 font-mono text-[13px] outline-none focus:bg-content/5 focus:ring-1 focus:ring-accent"
            />
          </form>
          <button
            type="button"
            title={t("Add folder ({p0}Enter)", { p0: MOD })}
            disabled={busy || loading || !directory || loadFailed}
            onClick={pick}
            className={`${actionClass} border border-stroke text-content`}
          >
            {t("Add")}
            {selected.length ? ` (${selected.length})` : ""}
          </button>
        </div>
        <nav
          aria-label={t("Locations")}
          className="flex flex-wrap gap-1 border-b border-stroke px-3 py-2"
        >
          <button
            type="button"
            disabled={busy || !home}
            className={actionClass}
            onClick={() => navigate(home)}
          >
            {t("Home folder")}
          </button>
          {roots.map((path) => (
            <button
              key={path}
              type="button"
              disabled={busy}
              aria-current={pathKey(path) === pathKey(directory) ? "location" : undefined}
              className={`${actionClass} border border-stroke font-mono`}
              onClick={() => navigate(path)}
            >
              {path}
            </button>
          ))}
        </nav>
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("Folders")}
          aria-multiselectable={multiple || undefined}
          tabIndex={0}
          aria-activedescendant={entries[active] ? `folder-picker-${active}` : undefined}
          title={t("↑ ↓ Navigate · Enter Open folder · Backspace Parent folder · Esc Close")}
          className="h-[min(340px,50vh)] overflow-y-auto overscroll-none p-1.5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
          onKeyDown={(event) => {
            if (busy || loading) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(entries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
                ),
              );
            } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              if (entries[active]) navigate(entries[active].path);
            } else if (event.key === "Backspace") {
              event.preventDefault();
              navigate(parent);
            } else if (event.key === " " && multiple && entries[active]) {
              event.preventDefault();
              const path = entries[active].path;
              setSelected((paths) =>
                paths.some((item) => pathKey(item) === pathKey(path))
                  ? paths.filter((item) => pathKey(item) !== pathKey(path))
                  : [...paths, path],
              );
            }
          }}
        >
          {loading ? (
            <p role="status" className="p-3 text-[13px] text-content/50">
              {t("Loading folders…")}
            </p>
          ) : entries.length === 0 && !error ? (
            <p className="p-3 text-[13px] text-content/50">{t("No subfolders")}</p>
          ) : null}
          {entries.map((entry, index) => (
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
              className={`flex items-center rounded-md ${index === active ? "bg-selection" : "hover:bg-content/5"}`}
            >
              {multiple ? (
                <input
                  type="checkbox"
                  aria-label={t("Select {p0}", { p0: entry.name })}
                  checked={selected.some((path) => pathKey(path) === pathKey(entry.path))}
                  onChange={(event) =>
                    setSelected((paths) =>
                      event.target.checked
                        ? [...paths, entry.path]
                        : paths.filter((path) => pathKey(path) !== pathKey(entry.path)),
                    )
                  }
                  className="ml-2 size-3.5 accent-accent"
                  disabled={busy}
                />
              ) : null}
              <button
                type="button"
                tabIndex={-1}
                title={t("{p0}\nOpen folder (Enter)", { p0: entry.path })}
                disabled={busy}
                onMouseEnter={() => setActive(index)}
                onClick={() => navigate(entry.path)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-[13px] text-content"
              >
                <Folder className="size-4 shrink-0 text-content/50" />
                <span className="truncate">{entry.name}</span>
              </button>
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
            <FolderPlus className="size-4 shrink-0 text-content/50" />
            <input
              autoFocus
              aria-label={t("New folder name")}
              placeholder={t("Folder name…")}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border border-stroke bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-accent"
            />
            <button type="submit" disabled={busy} className={actionClass}>
              {t("Create")}
            </button>
            <button
              type="button"
              disabled={busy}
              className={actionClass}
              onClick={() => {
                setNewName(null);
                setError(undefined);
                listRef.current?.focus();
              }}
            >
              {t("Cancel")}
            </button>
          </form>
        ) : null}
        {error ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <p role="alert" className="min-w-0 flex-1 break-words text-[12px] text-red-400">
              {error}
            </p>
            <button
              type="button"
              className={actionClass}
              disabled={busy}
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("Retry")}
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-stroke px-2 py-2">
          <button
            type="button"
            title={t("Create a folder in the current directory")}
            disabled={busy || loading || !directory}
            className={actionClass}
            onClick={() => {
              setNewName("");
              setError(undefined);
            }}
          >
            <FolderPlus className="size-3.5" />
            {t("New folder")}
          </button>
          <button
            type="button"
            title={t("Choose a drive, network location or folders using the system picker")}
            disabled={busy}
            className={actionClass}
            onClick={() =>
              void run(async () => {
                const paths = await pickNativeFolders(title, multiple);
                if (paths.length && mounted.current) onPick(paths);
              })
            }
          >
            {t("Browse…")}
          </button>
          <button
            type="button"
            title={`${managerLabel}\n${prettyCwd(directory)}`}
            disabled={busy || loading || !directory}
            className={actionClass}
            onClick={() => void run(() => openPathWithDefaultApp(directory))}
          >
            <FolderOpen className="size-3.5" />
            {managerLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
