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
  failDrafts: query.has("draft-error"),
  draftPuts: [] as Record<string, unknown>[],
  draftReports: [] as Record<string, unknown>[],
  nativeDraft: null as null | {
    metadata: Record<string, unknown>;
    payload: Record<string, unknown>;
  },
  copiedText: "",
  error:
    "Disk full while saving /fixture/notes.md. Free space on this machine, then retry the same draft. " +
    "The destination volume /volumes/" +
    "very-long-volume-name-".repeat(8) +
    " is unavailable.",
};
const nativeDraftOwner = "a".repeat(64);
async function digest(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function draftRecord(payload: Record<string, unknown>) {
  const text = payload.text as string;
  return {
    payload,
    metadata: {
      ownerId: nativeDraftOwner,
      storeInstance: "11111111-1111-4111-8111-111111111111",
      windowIncarnation: "22222222-2222-4222-8222-222222222222",
      windowLabel: "fixture",
      documentId: payload.documentId,
      path: payload.path,
      revision: payload.revision,
      payloadDigest: await digest(JSON.stringify(payload)),
      textDigest: await digest(text),
      serializedTextDigest: await digest(
        payload.eol === "crlf" ? text.replace(/\n/g, "\r\n") : text,
      ),
      baselineDigest: await digest(payload.diskBaseline as string),
      retainedBytes: new TextEncoder().encode(JSON.stringify(payload)).length + 600,
      state: "retained",
      saveAckId: null,
      updatedAt: 1,
    },
  };
}
if (query.has("native-draft")) {
  Object.assign(globalThis, { isTauri: true });
  if (query.has("restore-draft")) {
    controls.nativeDraft = await draftRecord({
      documentId: files[0].id,
      path: files[0].path,
      text: "# Recovered notes\nSaved recovery text\n",
      eol: "crlf",
      diskBaseline: disk,
      revision: 1,
    });
  }
}
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
      if (command === "native_editor_draft_open") {
        return { version: 1, qualified: false, ownerEpoch: nativeDraftOwner };
      }
      if (command === "native_editor_draft_read_current") {
        return structuredClone({ version: 1, qualified: false, record: controls.nativeDraft });
      }
      if (command === "native_editor_draft_put") {
        if (controls.failDrafts) throw new Error("Fixture draft storage unavailable");
        const capture = args.capture as Record<string, unknown>;
        if (capture.expectedRevision !== (controls.nativeDraft?.metadata.revision ?? null)) {
          throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
        }
        const payload = {
          documentId: capture.documentId,
          path: capture.path,
          text: capture.text,
          eol: capture.eol,
          diskBaseline: capture.diskBaseline,
          revision: capture.revision,
        };
        controls.nativeDraft = await draftRecord(payload);
        controls.draftPuts.push(payload);
        return structuredClone({ version: 1, qualified: false, record: controls.nativeDraft.metadata });
      }
      if (command === "native_editor_draft_clear_saved") {
        const saved = args.saved as Record<string, unknown>;
        if (
          !controls.nativeDraft ||
          saved.revision !== controls.nativeDraft.metadata.revision ||
          saved.payloadDigest !== controls.nativeDraft.metadata.payloadDigest
        )
          throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
        controls.draftReports.push(saved);
        controls.nativeDraft.metadata.state = "save-reported";
        controls.nativeDraft.metadata.saveAckId = "fixture-save-ack";
        return structuredClone({ version: 1, qualified: false, record: controls.nativeDraft.metadata });
      }
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
              documentId={entry.id}
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
