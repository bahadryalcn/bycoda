import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceRecoveryDialog } from "../../src/app/workspace/layout/WorkspaceRecoveryDialog";
import { useEditorDraftRecovery } from "../../src/app/workspace/files/useEditorDraftRecovery";
import { useOpenRecoveredEditorDraft } from "../../src/app/workspace/files/useOpenRecoveredEditorDraft";
import { useRecoveryControl } from "../../src/app/workspace/layout/useRecoveryControl";
import { FileEditor } from "../../src/features/files/ui/FileEditor";
import { SurfaceTabs } from "../../src/features/workspace/ui/SurfaceTabs";
import {
  newEditorWorkspaceTab,
  newFileTab,
  type WorkspaceTab,
} from "../../src/features/workspace/model/layout";
import type { NativeEditorDraftRecord } from "../../src/features/files/data/editorDraftPersistence";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { Button } from "../../src/shared/ui/Button";
import "../../src/styles/index.css";

// All Native IPC and filesystem effects below are FAKE. Components/hooks above
// are production code; this fixture does not start a Host, Native app or provider.
const query = new URLSearchParams(location.search);
localStorage.setItem("bycoda.autosave", query.has("autosave") ? "1" : "0");
localStorage.setItem("bycoda.formatOnSave", "0");
const filePath = "C:\\fixture\\notes.txt";
const cwd = "C:\\fixture";
const initialDocument = "55555555-5555-4555-8555-555555555555";
const storeInstance = "11111111-1111-4111-8111-111111111111";
const previousWindow = "22222222-2222-4222-8222-222222222222";
const currentWindow = "33333333-3333-4333-8333-333333333333";
const baseline = "Original disk text\r\nSecond line\r\n";
const sourceText = "Recovered unsaved text\nİstanbul 漢🦀\n";
const encoder = new TextEncoder();
async function sha(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
const currentOwner = await sha(`${storeInstance}:${currentWindow}`);
const sourceOwner = await sha(`${storeInstance}:${previousWindow}`);
const legacyRaw = JSON.stringify([{ path: filePath, dirty: true }]);
const legacySource = {
  sourceStoreId: "fixture-store",
  sourceProfileId: "fixture-profile",
  ownerId: "main",
  reportVersion: 1,
  snapshotDigest: await sha(legacyRaw),
};
const legacyReport = {
  source: legacySource,
  reportVersion: 1,
  ownerId: "main",
  kind: "legacy",
  windowLabel: "Earlier desktop report",
  updatedAt: 1,
  legacyTimestamp: null,
  retainedBytes: encoder.encode(legacyRaw).length,
  current: false,
  held: true,
  confirmed: false,
  contentAvailable: false,
  inspectable: true,
};
const legacyCalls: string[] = [];
const hostContext = {
  hostEnvironmentId: "fixture-profile-host",
  sourceStoreId: "fixture-store",
  sourceProfileId: "fixture-profile",
  nativeStoreInstance: storeInstance,
  clientId: "c".repeat(64),
};
const hostProvenance = {
  version: 2,
  sourceStoreId: hostContext.sourceStoreId,
  sourceProfileId: hostContext.sourceProfileId,
  storeInstance,
  windowIncarnation: previousWindow,
  kind: "physical",
  reportVersion: 1,
  reportNonce: initialDocument,
  snapshotDigest: "d".repeat(64),
};
const hostOwner = {
  ownerId: "host-owner",
  updatedAt: 11,
  unknown: false,
  buffers: [
    {
      path: query.has("host-scale")
        ? "C:\\fixture\\" + "long-reported-file-".repeat(160) + ".md"
        : filePath,
      dirty: true,
    },
  ],
  source: hostProvenance,
};
const hostInstance = "fixture-native-instance";
const hostRaw = JSON.stringify({
  clientId: hostContext.clientId,
  instanceId: hostInstance,
  device: "a".repeat(64),
  processId: 1,
  receivedAt: 11,
  owners: [hostOwner],
  recovery: { reportVersion: 3, ownerVersions: { "host-owner": 7 } },
});
const hostSource = {
  reportId: await sha(JSON.stringify(["a".repeat(64), hostContext.clientId, hostInstance])),
  reportVersion: 3,
  ownerId: hostOwner.ownerId,
  ownerVersion: 7,
  snapshotDigest: await sha(hostRaw),
};
const hostReport = {
  source: hostSource,
  clientId: hostContext.clientId,
  instanceId: hostInstance,
  processId: 1,
  updatedAt: 11,
  byteLength: encoder.encode(hostRaw).length,
  bufferCount: 1,
  dirtyCount: 1,
  unknown: false,
  provenance: hostProvenance,
  lineage: "physical",
  ownerMissing: false,
  compatibilityHoldId: "b".repeat(64),
  verification: "raw-checked",
  retention: "held",
  inspectable: true,
  qualified: false,
  resolution: "unsupported",
};
const hostCursor = { version: 1, cursorId: initialDocument, page: 1 };
const hostCalls: { command: string; args: Record<string, any> }[] = [];
let failHostRead = query.has("host-error");
let holdHostRead = query.has("hold-host");
let releaseHostRead: (() => void) | undefined;
let failLegacyRead = query.has("legacy-error");
let holdLegacyRead = query.has("hold-legacy");
let releaseLegacyRead: (() => void) | undefined;
let updatePrivacy: ((allowed: boolean) => void) | undefined;
let privacyRevision = 0;
type Payload = NativeEditorDraftRecord["payload"];
async function makeRecord(payload: Payload, previous = false): Promise<NativeEditorDraftRecord> {
  // Explicit serde DraftPayload order; no caller property ordering assumption.
  const ordered = {
    documentId: payload.documentId,
    path: payload.path,
    text: payload.text,
    eol: payload.eol,
    diskBaseline: payload.diskBaseline,
    revision: payload.revision,
  };
  const raw = JSON.stringify(ordered);
  const label = previous ? "Earlier desktop window" : "editor-recovery-fixture";
  const serialized =
    ordered.eol === "lf"
      ? ordered.text
      : ordered.text.replace(/\n/g, ordered.eol === "crlf" ? "\r\n" : "\r");
  return {
    payload: ordered,
    metadata: {
      ownerId: previous ? sourceOwner : currentOwner,
      storeInstance,
      windowIncarnation: previous ? previousWindow : currentWindow,
      windowLabel: label,
      documentId: ordered.documentId,
      path: ordered.path,
      revision: ordered.revision,
      payloadDigest: await sha(raw),
      textDigest: await sha(ordered.text),
      serializedTextDigest: await sha(serialized),
      baselineDigest: await sha(ordered.diskBaseline),
      retainedBytes: encoder.encode(raw + ordered.documentId + ordered.path + label).length + 512,
      state: "retained",
      saveAckId: null,
      updatedAt: 1,
    },
  };
}
let source = await makeRecord(
  {
    documentId: "previous-document",
    path: filePath,
    text: sourceText,
    eol: "crlf",
    diskBaseline: baseline,
    revision: 3,
  },
  true,
);
const originalSource = structuredClone(source);
const key = (owner: string, document: string) => `${owner}:${document}`;
const rows = new Map([[key(sourceOwner, source.payload.documentId), source]]);
let disk: string | null =
  query.get("disk") === "missing"
    ? null
    : query.get("disk") === "changed"
      ? "Externally changed disk\r\n"
      : baseline;
const writes: Array<{ path: string; content: string }> = [];
const puts: Array<{ documentId: string; revision: number; text: string }> = [];
const putRequests: Array<{ documentId: string; revision: number }> = [];
const reports: Array<Record<string, unknown>> = [];
const recoveryReads: Array<Record<string, unknown>> = [];
let holdTarget = query.has("hold-target");
let releasePut: (() => void) | undefined;
let failTargetAck = query.has("lost-ack");
let failedReconciliationReads = 0;
let currentTabs: WorkspaceTab[] = [];
let currentDirty: string[] = [];
let selectedTab = "";
const controls = {
  snapshot: () =>
    structuredClone({
      disk,
      writes,
      puts,
      putRequests,
      reports,
      recoveryReads,
      source,
      originalSource,
      legacyReport,
      legacyCalls,
      hostCalls,
      hostReport,
      hostContext,
      hostCursor,
      rows: [...rows.values()],
      tabs: currentTabs,
      dirty: currentDirty,
      selectedTab,
      held: !!releasePut,
      initialDocument,
      filePath,
      sourceOwner,
      currentOwner,
    }),
  setTheme: (light: boolean) => applyThemePreference(light ? "light" : "dark"),
  setPrivacy(allowed: boolean) {
    privacyRevision++;
    updatePrivacy?.(allowed);
  },
  releaseLegacyRead() {
    holdLegacyRead = false;
    releaseLegacyRead?.();
    releaseLegacyRead = undefined;
  },
  releaseHostRead() {
    holdHostRead = false;
    releaseHostRead?.();
    releaseHostRead = undefined;
  },
  releasePut() {
    holdTarget = false;
    releasePut?.();
    releasePut = undefined;
  },
  async advanceSource() {
    source = await makeRecord(
      {
        ...source.payload,
        text: "Updated source revision\nDo not use the old catalog receipt\n",
        revision: source.payload.revision + 1,
      },
      true,
    );
    rows.set(key(sourceOwner, source.payload.documentId), source);
  },
};
Object.assign(globalThis, { isTauri: true });
Object.assign(window, {
  editorRecoveryFixture: controls,
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "editor-recovery-fixture" },
      currentWebview: { label: "editor-recovery-fixture" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, any> = {}) => {
      if (command.startsWith("managed_workspace_host_buffer_recovery_")) {
        hostCalls.push({ command, args: structuredClone(args) });
        if (command === "managed_workspace_host_buffer_recovery_list") {
          const empty = query.has("host-empty") && args.request.after === null;
          if (
            args.request.after !== null &&
            (JSON.stringify(args.request.after) !== JSON.stringify(hostCursor) ||
              JSON.stringify(args.expectedContext) !== JSON.stringify(hostContext))
          )
            throw new Error("Fixture opaque continuation changed");
          return structuredClone({
            version: 1,
            qualified: false,
            resolution: "unsupported",
            context: hostContext,
            records: empty
              ? []
              : Array.from({ length: query.has("host-scale") ? 25 : 1 }, () => hostReport),
            next: empty ? hostCursor : null,
            incomplete: false,
            duplicatesPossible: true,
            unavailable: !empty,
          });
        }
        if (
          JSON.stringify(args.source) !== JSON.stringify(hostSource) ||
          JSON.stringify(args.expectedContext) !== JSON.stringify(hostContext)
        )
          throw new Error("Fixture Host source/context changed");
        if (command === "managed_workspace_host_buffer_recovery_read") {
          if (holdHostRead)
            await new Promise<void>((resolve) => {
              releaseHostRead = resolve;
            });
          if (failHostRead) {
            failHostRead = false;
            throw new Error("Fixture private diagnostic must not reach the UI");
          }
          return structuredClone({
            version: 1,
            qualified: false,
            source: hostSource,
            rawReport: hostRaw,
            owner: hostOwner,
            resolution: "unsupported",
            context: hostContext,
            buffers: hostOwner.buffers,
            contentAvailable: false,
          });
        }
        if (command === "managed_workspace_host_buffer_recovery_status")
          return structuredClone({
            version: 1,
            qualified: false,
            resolution: "unsupported",
            context: hostContext,
            source: hostSource,
            found: true,
            inspectable: true,
            unavailable: false,
          });
        throw new Error("Unexpected Host recovery mutation");
      }
      if (command.startsWith("managed_workspace_buffer_recovery_")) {
        legacyCalls.push(command);
        if (command === "managed_workspace_buffer_recovery_list")
          return structuredClone({
            version: 1,
            qualified: false,
            records: [
              legacyReport,
              {
                ...legacyReport,
                source: null,
                reportVersion: 2,
                windowLabel: "Uninspectable retained report",
                inspectable: false,
              },
            ],
            next: null,
          });
        if (command === "managed_workspace_buffer_recovery_read") {
          if (JSON.stringify(args.source) !== JSON.stringify(legacySource))
            throw new Error("Fixture legacy source changed");
          if (holdLegacyRead)
            await new Promise<void>((resolve) => {
              releaseLegacyRead = resolve;
            });
          if (failLegacyRead) {
            failLegacyRead = false;
            throw new Error("Fixture retained source temporarily unavailable");
          }
          return structuredClone({
            version: 1,
            qualified: false,
            record: legacyReport,
            rawSnapshot: legacyRaw,
            buffers: [{ path: filePath, dirty: true }],
          });
        }
        throw new Error(`Unexpected legacy mutation: ${command}`);
      }
      if (command === "native_editor_draft_open")
        return { version: 1, qualified: false, ownerEpoch: currentOwner };
      if (command === "native_editor_draft_inventory") {
        const { after, limit } = args.request;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          throw new Error("NATIVE_EDITOR_DRAFT_INVALID_INVENTORY");
        const all = (query.has("legacy-only") ? [] : [...rows.values()])
          .map((row) => row.metadata)
          .sort((a, b) =>
            a.ownerId < b.ownerId
              ? -1
              : a.ownerId > b.ownerId
                ? 1
                : a.documentId < b.documentId
                  ? -1
                  : 1,
          )
          .filter(
            (row) =>
              !after ||
              row.ownerId > after.ownerId ||
              (row.ownerId === after.ownerId && row.documentId > after.documentId),
          );
        const records = all.slice(0, limit);
        const last = records.at(-1);
        return structuredClone({
          version: 1,
          qualified: false,
          records,
          next:
            all.length > limit && last
              ? { ownerId: last.ownerId, documentId: last.documentId }
              : null,
        });
      }
      if (command.startsWith("native_editor_draft_")) {
        const input = args.request ?? args.capture ?? args.document ?? args.saved;
        if (input?.ownerEpoch !== currentOwner)
          throw new Error("NATIVE_EDITOR_DRAFT_OWNER_CHANGED");
        if (command === "native_editor_draft_read_recovery") {
          recoveryReads.push(structuredClone(input.source));
          const wanted = input.source;
          const record = rows.get(key(wanted.ownerId, wanted.documentId));
          if (
            !record ||
            record.metadata.revision !== wanted.revision ||
            record.metadata.payloadDigest !== wanted.payloadDigest
          )
            throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
          return structuredClone({ version: 1, qualified: false, record });
        }
        if (command === "native_editor_draft_read_current") {
          if (input.documentId !== initialDocument && failedReconciliationReads > 0) {
            failedReconciliationReads--;
            throw new Error("Fixture reconciliation temporarily unavailable");
          }
          return structuredClone({
            version: 1,
            qualified: false,
            record: rows.get(key(currentOwner, input.documentId)) ?? null,
          });
        }
        if (command === "native_editor_draft_put") {
          putRequests.push({ documentId: input.documentId, revision: input.revision });
          const target = input.documentId !== initialDocument;
          if (target && holdTarget)
            await new Promise<void>((resolve) => {
              releasePut = resolve;
            });
          const prior = rows.get(key(currentOwner, input.documentId));
          const payload = {
            documentId: input.documentId,
            path: input.path,
            text: input.text,
            eol: input.eol,
            diskBaseline: input.diskBaseline,
            revision: input.revision,
          };
          if (
            prior?.metadata.revision === payload.revision &&
            prior.metadata.payloadDigest === (await sha(JSON.stringify(payload)))
          )
            return structuredClone({ version: 1, qualified: false, record: prior.metadata });
          if (
            (prior?.metadata.revision ?? null) !== input.expectedRevision ||
            input.revision <= (prior?.metadata.revision ?? 0)
          )
            throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
          const record = await makeRecord(payload);
          rows.set(key(currentOwner, input.documentId), record);
          puts.push({ documentId: input.documentId, revision: input.revision, text: input.text });
          if (target && failTargetAck) {
            failTargetAck = false;
            failedReconciliationReads = 1;
            throw new Error("Fixture lost committed target ACK");
          }
          return structuredClone({ version: 1, qualified: false, record: record.metadata });
        }
        if (command === "native_editor_draft_clear_saved") {
          const record = rows.get(key(currentOwner, input.documentId));
          if (
            !record ||
            record.metadata.revision !== input.revision ||
            record.metadata.payloadDigest !== input.payloadDigest ||
            record.metadata.serializedTextDigest !== input.savedTextDigest
          )
            throw new Error("NATIVE_EDITOR_DRAFT_REVISION_CONFLICT");
          const updated: NativeEditorDraftRecord = {
            ...record,
            metadata: {
              ...record.metadata,
              state: "save-reported",
              saveAckId: record.metadata.saveAckId ?? crypto.randomUUID(),
            },
          };
          rows.set(key(currentOwner, input.documentId), updated);
          reports.push(structuredClone(input));
          return structuredClone({ version: 1, qualified: false, record: updated.metadata });
        }
        throw new Error(`Unexpected fake Native draft command: ${command}`);
      }
      if (command === "read_text_file") {
        if (args.path !== filePath) throw new Error("Fixture path unavailable");
        if (disk === null) throw new Error("Fixture file is missing");
        return disk;
      }
      if (command === "write_text_file") {
        if (args.path !== filePath) throw new Error("Fixture path unavailable");
        disk = args.content;
        writes.push({ path: args.path, content: args.content });
        return;
      }
      if (command === "stat_files")
        return (args.paths as string[]).map((path) => ({
          path,
          mtimeMs: 1,
          size: disk?.length ?? 0,
          isDir: false,
        }));
      if (command === "plugin:event|listen") return 1;
      if (command === "plugin:event|unlisten") return;
      return [];
    },
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
});
applyThemePreference(query.has("light") ? "light" : "dark");
const initialFile = { ...newFileTab(filePath, cwd), id: initialDocument };
const initialWorkspace = newEditorWorkspaceTab(initialFile);

function Fixture() {
  const [tabs, setTabs] = useState([initialWorkspace]);
  const tabsRef = useRef(tabs);
  const [active, setActive] = useState(initialWorkspace.id);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState(false);
  const [inspectAllowed, setInspectAllowed] = useState(true);
  const [, setTerminalFocused] = useState(false);
  const [, setComposerFocused] = useState(false);
  useLayoutEffect(() => {
    updatePrivacy = setInspectAllowed;
    return () => {
      updatePrivacy = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
    currentTabs = tabs;
    currentDirty = [...dirty];
    selectedTab = active;
  }, [tabs, dirty, active]);
  const opener = useOpenRecoveredEditorDraft({
    tabsRef,
    setTabs,
    insertBesideActive: (previous, tab) => [...previous, tab],
    activateTab: setActive,
    setActiveTabId: setActive,
    setProjectTerminalFocused: setTerminalFocused,
    setComposerFocused,
    allowPath: (path) => path === filePath,
  });
  const recovery = useEditorDraftRecovery({
    allowPath: (path) => path === filePath,
    isTargetOpen: (id) =>
      tabsRef.current.some((tab) =>
        tab.editorPanes.some((pane) => pane.files.some((file) => file.id === id)),
      ),
    onOpen: async (prepared) => {
      await opener.openRecoveredEditorDraft(prepared, cwd);
      setDialog(false);
    },
  });
  const recoveryControl = useRecoveryControl({
    toolWindow: null,
    windowTransfer: null,
    recoveryCount: 0,
    editorDraftCount: recovery.records.filter(
      (record) =>
        record.state === "retained" && record.serializedTextDigest !== record.baselineDigest,
    ).length,
    editorDraftAvailable: recovery.available,
    setRecoveryOpen: setDialog,
    clearRecoveredSessions: async () => {},
  });
  return (
    <main className="flex h-dvh min-w-0 flex-col bg-(--ui-surface) text-content">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke p-2">
        {recoveryControl}
        <span className="text-ui-caption text-(--ui-text-secondary)">
          Fixture: Native storage and disk are fake; no conversation journal.
        </span>
      </header>
      <nav
        aria-label="Workspace documents"
        className="flex shrink-0 gap-1 border-b border-stroke p-1"
      >
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={tab.id === active ? "secondary" : "ghost"}
            aria-pressed={tab.id === active}
            onClick={() => setActive(tab.id)}
          >
            {tab.id === initialWorkspace.id ? "Existing document" : "Recovered copy"}
          </Button>
        ))}
      </nav>
      {tabs.map((tab) => {
        const pane = tab.editorPanes[0];
        return (
          <section
            key={tab.id}
            data-workspace={tab.id === initialWorkspace.id ? "existing" : "recovered"}
            className={tab.id === active ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            <SurfaceTabs
              files={pane.files}
              activeFileId={pane.activeFileId}
              dirtyFileIds={dirty}
              fileErrorCounts={new Map()}
              onSelectFile={() => {}}
              onCloseFile={() => {}}
              onCloseOtherFiles={() => {}}
              onReorder={() => {}}
            />
            {pane.files.map((file) => (
              <div key={file.id} className="min-h-0 flex-1">
                <FileEditor
                  documentId={file.id}
                  path={file.path}
                  cwd={cwd}
                  active={tab.id === active}
                  shown={tab.id === active}
                  recoveredEditorDraft={file.recoveredEditorDraft}
                  onDirtyChange={(_path, changed) =>
                    setDirty((previous) => {
                      if (previous.has(file.id) === changed) return previous;
                      const next = new Set(previous);
                      if (changed) next.add(file.id);
                      else next.delete(file.id);
                      return next;
                    })
                  }
                />
              </div>
            ))}
          </section>
        );
      })}
      {dialog ? (
        <WorkspaceRecoveryDialog
          recovery={null}
          sessions={[]}
          remoteSessions={[]}
          editorDraftRecovery={recovery}
          editorDraftRecords={recovery.records}
          canInspectLegacyReports={() => inspectAllowed}
          getLegacyReportPrivacySnapshot={() => privacyRevision}
          onClose={() => setDialog(false)}
          onOpen={async () => {
            throw new Error("No conversation fixture exists");
          }}
          onRemove={async () => {}}
        />
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
