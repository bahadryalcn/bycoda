import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FileEditor } from "../../src/features/files/ui/FileEditor";
import { Button } from "../../src/shared/ui/Button";
import { SurfaceTabs } from "../../src/features/workspace/ui/SurfaceTabs";
import { newFileTab } from "../../src/features/workspace/model/layout";
import { WorkspaceEditorSettings } from "../../src/features/settings/ui/WorkspaceEditorSettings";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

localStorage.setItem("bycoda.autosave", "0");
localStorage.setItem("bycoda.formatOnSave", "0");
let disk = "# Notes\r\nOriginal text\r\n";
let writes = 0;
const query = new URLSearchParams(location.search);
const files = [newFileTab("/fixture/notes.md", "/fixture")];
if (query.has("same-name")) files.push(newFileTab("/fixture/archive/notes.md", "/fixture"));
const documents = new Map(
  files.map((file, index) => [file.path, index ? "# Archive\r\nArchived text\r\n" : disk]),
);
const controls = {
  failWrites: query.has("save-error"),
  copiedText: "",
  error:
    "Disk full while saving /fixture/notes.md. Free space on this machine, then retry the same draft. " +
    "The destination volume /volumes/" +
    "very-long-volume-name-".repeat(8) +
    " is unavailable.",
};
if (query.has("same-name")) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        controls.copiedText = text;
      },
    },
  });
}
Object.assign(window, {
  fileSaveFixture: controls,
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "read_text_file") return documents.get(args.path as string) ?? disk;
      if (command === "copy_text_to_clipboard") {
        controls.copiedText = args.text as string;
        return;
      }
      if (command === "write_text_file") {
        if (controls.failWrites) throw new Error(controls.error);
        disk = args.content as string;
        documents.set(args.path as string, disk);
        document.querySelector("output")!.textContent = `${++writes}: ${disk}`;
        return;
      }
      return [];
    },
  },
});
applyThemePreference(new URLSearchParams(location.search).has("light") ? "light" : "dark");

function Fixture() {
  const [activeFileId, setActiveFileId] = useState(files[0].id);
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());
  const file = files.find((entry) => entry.id === activeFileId)!;
  const dirty = dirtyFileIds.has(file.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <main className="flex h-dvh min-w-0 flex-col bg-[var(--ui-surface)] text-content">
      <div className="flex shrink-0 items-center gap-2 border-b border-stroke p-2">
        <Button data-explorer-root variant="ghost">
          notes.md{dirty ? " •" : ""}
        </Button>
        <span>{dirty ? "Dirty" : "Clean"}</span>
        <Button variant="ghost" onClick={() => setSettingsOpen(!settingsOpen)}>
          Editor settings
        </Button>
      </div>
      {settingsOpen ? <WorkspaceEditorSettings /> : null}
      <section className="flex min-h-0 flex-1 flex-col">
        <SurfaceTabs
          files={files}
          activeFileId={file.id}
          dirtyFileIds={dirtyFileIds}
          fileErrorCounts={new Map()}
          onSelectFile={setActiveFileId}
          onCloseFile={() => {}}
          onCloseOtherFiles={() => {}}
          onReorder={() => {}}
        />
        {files.map((entry) => (
          <div
            key={entry.id}
            className={entry.id === activeFileId ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            <FileEditor
              path={entry.path}
              cwd="/fixture"
              active={entry.id === activeFileId}
              onDirtyChange={(_path, value) =>
                setDirtyFileIds((previous) => {
                  const next = new Set(previous);
                  if (value) next.add(entry.id);
                  else next.delete(entry.id);
                  return next;
                })
              }
            />
          </div>
        ))}
      </section>
      <textarea aria-label="Chat draft" className="h-16 shrink-0 border-t border-stroke" />
      <output aria-label="Disk writes" className="shrink-0 truncate">
        0
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
