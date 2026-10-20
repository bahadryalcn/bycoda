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
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "read_text_file") return disk;
      if (command === "write_text_file") {
        disk = args.content as string;
        document.querySelector("output")!.textContent = `${++writes}: ${disk}`;
        return;
      }
      return [];
    },
  },
});
applyThemePreference(new URLSearchParams(location.search).has("light") ? "light" : "dark");
const file = newFileTab("/fixture/notes.md", "/fixture");

function Fixture() {
  const [dirty, setDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <main className="flex h-dvh min-w-0 flex-col bg-[var(--ui-surface)] text-content">
      <div className="flex shrink-0 items-center gap-2 border-b border-stroke p-2">
        <Button data-explorer-root variant="ghost">
          notes.md{dirty ? " •" : ""}
        </Button>
        <span>{dirty ? "Dirty" : "Clean"}</span>
        <Button variant="ghost" onClick={() => setSettingsOpen(!settingsOpen)}>Editor settings</Button>
      </div>
      {settingsOpen ? <WorkspaceEditorSettings /> : null}
      <section className="flex min-h-0 flex-1 flex-col">
        <SurfaceTabs
          files={[file]}
          activeFileId={file.id}
          dirtyFileIds={new Set(dirty ? [file.id] : [])}
          fileErrorCounts={new Map()}
          onSelectFile={() => {}}
          onCloseFile={() => {}}
          onCloseOtherFiles={() => {}}
          onReorder={() => {}}
        />
        <FileEditor
          path="/fixture/notes.md"
          cwd="/fixture"
          active
          onDirtyChange={(_path, value) => setDirty(value)}
        />
      </section>
      <textarea aria-label="Chat draft" className="h-16 shrink-0 border-t border-stroke" />
      <output aria-label="Disk writes" className="shrink-0 truncate">
        0
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
