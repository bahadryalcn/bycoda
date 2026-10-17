import { createRoot } from "react-dom/client";
import { useState } from "react";
import { FileTree } from "../../src/features/files/ui/FileTree";
import {
  handleFilePreviewFindKey,
  FilePreviewSearch,
} from "../../src/features/files/ui/FilePreviewSearch";
import type { FsEntry } from "../../src/platform/tauri/fs";
import "../../src/styles/index.css";

localStorage.setItem("bycoda.language.technical", "en");
window.addEventListener("keydown", handleFilePreviewFindKey);
const entry = (name: string, parent = "/fixture", isDir = false): FsEntry => ({
  name,
  path: `${parent}/${name}`,
  isDir,
  ignored: false,
});
const dirs = new Map<string, FsEntry[]>([
  [
    "/fixture",
    [
      entry("src", "/fixture", true),
      entry("dest", "/fixture", true),
      entry("bulk", "/fixture", true),
      entry("a.ts"),
      entry("b.ts"),
    ],
  ],
  ["/fixture/src", [entry("deep.ts", "/fixture/src")]],
  ["/fixture/dest", []],
  [
    "/fixture/bulk",
    Array.from({ length: 350 }, (_, i) =>
      entry(`item${String(i).padStart(3, "0")}.ts`, "/fixture/bulk"),
    ),
  ],
]);
const callbacks = new Map<number, (event: unknown) => void>(),
  listeners = new Map<string, number>();
let nextId = 0;
const operations: { command: string; args: Record<string, unknown> }[] = [];
Object.assign(window, {
  treeNativeEmit: (name: string, payload: unknown) =>
    callbacks.get(listeners.get(name) ?? -1)?.({ event: name, id: 0, payload }),
  treeOperations: operations,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: (callback: (event: unknown) => void) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "plugin:event|listen") {
        listeners.set(String(args.event), Number(args.handler));
        return ++nextId;
      }
      if (command === "plugin:event|unlisten") return;
      if (command === "list_dir") return dirs.get(String(args.path)) ?? [];
      if (command === "clipboard_file_paths") return [];
      if (command === "rename_path") {
        operations.push({ command, args });
        const old = String(args.path),
          parent = old.slice(0, old.lastIndexOf("/"));
        const name = String(args.name),
          path = `${parent}/${name}`;
        dirs.set(
          parent,
          (dirs.get(parent) ?? []).map((item) =>
            item.path === old ? { ...item, name, path } : item,
          ),
        );
        return path;
      }
      if (command === "copy_path") {
        operations.push({ command, args });
        const parent = String(args.destParent),
          name = String(args.from).split("/").pop()!;
        dirs.set(parent, [...(dirs.get(parent) ?? []), entry(name, parent)]);
        return `${parent}/${name}`;
      }
      if (command === "git_discover") return null;
      return [];
    },
  },
});
function Fixture() {
  const [opened, setOpened] = useState("");
  const preview = new URLSearchParams(location.search).has("preview");
  return (
    <main className="flex h-dvh min-w-0 bg-[var(--ui-surface)] text-content">
      {preview ? (
        <FilePreviewSearch active contentVersion="fixture">
          <section className="markdown-preview p-4" aria-label="Markdown preview" tabIndex={0}>
            <p>First needle appears here.</p>
            <p>Second needle remains searchable.</p>
          </section>
        </FilePreviewSearch>
      ) : (
        <>
          <section
            className="flex min-h-0 max-w-full flex-col"
            style={{ width: "min(320px,100vw)" }}
          >
            <FileTree cwd="/fixture" rootLabel="Fixture" onOpenFile={(path) => setOpened(path)} />
          </section>
          <output aria-label="Opened file" className="min-w-0 flex-1 truncate">
            {opened}
          </output>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
