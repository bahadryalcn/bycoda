import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "../../src/app/shell/Sidebar";
import type { EditorView } from "@codemirror/view";
import { AgentMarkdown } from "../../src/features/sessions/ui/AgentMarkdown";
import {
  LocalSessionReferenceProvider,
  type LocalSessionReferenceNavigation,
} from "../../src/features/sessions/ui/LocalSessionReferenceContext";
import { buildLocalSessionLink } from "../../src/features/sessions/model/localSessionReference";
import { NoteEditablePreview } from "../../src/features/notes/ui/NoteEditablePreview";
import { AgentTabView } from "../../src/features/sessions/ui/AgentTabView";
import { newDefaultSession } from "../../src/features/sessions/model/session";
import {
  setFixtureWorkerMode,
  type WorkerMode,
} from "./session-references-host-reader";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Real shared renderer/Popover/Notes; memory-only navigation and metadata.
// This fixture never loads the owner's sessions or their Native/Host databases.
document.documentElement.classList.toggle(
  "theme-light",
  new URLSearchParams(location.search).get("theme") === "light",
);
const clipboardFailure = () =>
  !!(window as unknown as { fixtureClipboardFailure?: boolean })
    .fixtureClipboardFailure;
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    async writeText(text: string) {
      if (clipboardFailure())
        throw new Error("Clipboard temporarily unavailable");
      Object.assign(window, { fixtureCopiedText: text });
    },
  },
});
const execCommand = document.execCommand.bind(document);
document.execCommand = (command, ...args) =>
  command === "copy" && clipboardFailure()
    ? false
    : execCommand(command, ...args);
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "fixture" },
      currentWebview: { label: "fixture" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (
      command: string,
      args?: { sessionId?: string; text?: string },
    ) => {
      if (command === "plugin:event|listen") return 1;
      if (
        command === "session_reference_get" ||
        command === "session_reference_resolve"
      )
        return {
          locator: {
            kind: "native",
            sourceStoreId: "stable-store",
            sourceProfileId: "profile-1",
            sessionId: args?.sessionId ?? "native-session",
          },
          title: "Reference copy target",
          cwd: "G:/Projects/example-project",
          archived: false,
          updatedAt: 1,
        };
      if (
        command === "plugin:clipboard-manager|write_text" ||
        command === "copy_text_to_clipboard"
      ) {
        if (clipboardFailure())
          throw new Error("Clipboard temporarily unavailable");
        Object.assign(window, { fixtureCopiedText: args?.text });
        return;
      }
      return null;
    },
  },
});

const hostLink = buildLocalSessionLink({
  locator: {
    kind: "host",
    environmentId: "local-host",
    sessionId: "stable-session",
  },
  turnId: "turn-2",
});
const nativeLink = buildLocalSessionLink({
  kind: "native",
  sourceStoreId: "stable-store",
  sourceProfileId: "profile-1",
  sessionId: "native-session",
});
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const worker = {
  ...newDefaultSession("G:/Projects/example-project"),
  id: "fixture-worker-shell",
  title: "Linked Host worker",
  hostBinding: {
    kind: "local-host" as const,
    machineId: "fixture-host",
    environmentId: "local-host",
    projectId: "fixture-project",
    sessionId: "worker-session",
    authorityGeneration: null,
    created: true,
  },
  blocks: [
    {
      id: "worker-user-turn",
      role: "user" as const,
      text: "Review the local reference navigation.",
      createdAt: 1,
    },
    {
      id: "worker-assistant-turn",
      role: "assistant" as const,
      text: `I read [Earlier investigation](${hostLink}). The saved reference keeps its original title and opens the exact conversation.`,
      createdAt: 2,
    },
  ],
};

function Fixture() {
  const [failure, setFailure] = useState(false);
  const [slow, setSlow] = useState(false);
  const [missingTurn, setMissingTurn] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [opened, setOpened] = useState("No session opened");
  const [note, setNote] = useState(
    `# Investigation notes\n\nThis exact source remains editable. [Related conversation](${hostLink}).\n\nAnother paragraph remains readable.`,
  );
  const [editing, setEditing] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  const navigation = useMemo<LocalSessionReferenceNavigation>(
    () => ({
      async resolve(reference) {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 1000));
        if (failure) throw new Error("This local session is unavailable.");
        return {
          title: "Current renamed title — investigation and recovery",
          project: "G:/Projects/example-project",
          origin:
            reference.locator.kind === "host"
              ? "Local Host"
              : "Local Native profile",
          status: "idle",
          archived: reference.locator.kind === "native",
        };
      },
      async open(reference, options) {
        setOpenCount((count) => count + 1);
        if (slow) await new Promise((resolve) => setTimeout(resolve, 1000));
        if (failure) throw new Error("This local session is unavailable.");
        if (missingTurn && reference.turnId)
          throw new Error(
            "The cited turn is unavailable. Open the conversation without the turn reference.",
          );
        setOpened(
          `${options?.beside ? "Beside" : "Focused"}: ${reference.locator.sessionId}${reference.turnId ? ` · ${reference.turnId}` : ""}`,
        );
      },
    }),
    [failure, slow, missingTurn],
  );

  return (
    <LocalSessionReferenceProvider value={navigation}>
      <main>
        <h1>Local session references</h1>
        <p className="fixture-caption">
          Browser fixture · real Markdown, shared controls and Notes · in-memory
          metadata/navigation
        </p>
        <div className="fixture-controls">
          <label>
            <input
              type="checkbox"
              checked={failure}
              onChange={(event) => setFailure(event.target.checked)}
            />{" "}
            Unavailable target
          </label>
          <label>
            <input
              type="checkbox"
              checked={slow}
              onChange={(event) => setSlow(event.target.checked)}
            />{" "}
            Slow response
          </label>
          <label>
            <input
              type="checkbox"
              checked={missingTurn}
              onChange={(event) => setMissingTurn(event.target.checked)}
            />{" "}
            Missing cited turn
          </label>
          <label>
            <input
              type="checkbox"
              onChange={(event) =>
                Object.assign(window, {
                  fixtureClipboardFailure: event.target.checked,
                })
              }
            />{" "}
            Clipboard failure
          </label>
        </div>
        <section aria-label="Conversation references">
          <h2>Conversation</h2>
          <AgentMarkdown
            text={`I read [Earlier investigation](${hostLink}) and kept its original citation text.\n\nThe [Archived native conversation](${nativeLink}) remains in its archive.\n\nLiteral reference: \`${hostLink}\`.`}
          />
          <output className="fixture-output" data-opened>
            {opened}
          </output>
          <output className="fixture-output" data-open-count>
            {openCount}
          </output>
        </section>
        <section aria-label="Notes references">
          <h2>Notes</h2>
          <NoteEditablePreview
            value={note}
            cwd="G:/Projects/example-project"
            viewRef={viewRef}
            rangeRef={rangeRef}
            onChange={setNote}
            onSave={() => {}}
            onPasteImages={() => {}}
            onEditingChange={setEditing}
            onFocus={() => {}}
          />
          <output className="fixture-output" data-note-editing>
            {editing ? "Editing" : "Reading"}
          </output>
        </section>
        <section aria-label="Session copy menu">
          <h2>Session menu</h2>
          <div
            style={{
              blockSize: "26rem",
              inlineSize: "20rem",
              maxInlineSize: "100%",
              display: "flex",
              position: "relative",
            }}
          >
            <Sidebar
              cwd="G:/Projects/example-project"
              open
              sessions={[
                {
                  id: "native-session",
                  cwd: "G:/Projects/example-project",
                  title: "Reference copy target",
                  harness: "codex",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              ]}
              busySessionIds={new Set()}
              approvalSessionIds={new Set()}
              status="idle"
              pending={false}
              onSelectSession={() => {}}
              onOpenFile={async () => {}}
              tab="sessions"
              onTabChange={() => {}}
              filesSearchOpen={false}
              onFilesSearchOpenChange={() => {}}
            />
          </div>
        </section>
        <section aria-label="Host worker reference">
          <h2>Host worker · in-memory read transport</h2>
          <label>
            Worker state{" "}
            <select
              aria-label="Worker state"
              defaultValue="ready"
              onChange={(event) =>
                setFixtureWorkerMode(event.target.value as WorkerMode)
              }
            >
              <option value="ready">Ready</option>
              <option value="loading">Loading</option>
              <option value="error">Error</option>
            </select>
          </label>
          <div
            style={{
              blockSize: "24rem",
              marginBlockStart: "1rem",
              border: "1px solid var(--ui-tone-neutral-border)",
              background: "var(--ui-surface)",
            }}
          >
            <AgentTabView
              title="Linked Host worker"
              session={worker}
              visible
              focused={false}
            />
          </div>
        </section>
      </main>
    </LocalSessionReferenceProvider>
  );
}

void languageReady.then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
      <Fixture />
    </QueryClientProvider>,
  ),
);
