import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotesView } from "../../src/features/notes/ui/NotesView";
import { SessionNotesPanel } from "../../src/features/notes/ui/SessionNotesPanel";
import { useEffect, useState } from "react";
import { OPEN_NOTE_LIBRARY_EVENT } from "../../src/features/notes/noteNavigation";
import { setLanguagePreference } from "../../src/shared/i18n";
import { summarizeNote, type Note, type NoteUpsert } from "../../src/features/notes/notes";
import "../../src/styles/index.css";

// Memory-only bridge. This fixture never reads or writes the owner's notes.
const parameters = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", parameters.get("theme") === "light");
const count = parameters.get("count") === "1000" ? 1000 : 42;
const padding =
  count === 1000 || parameters.has("long") ? "\n\n" + "Long note paragraph. ".repeat(1100) : "";
const notes: Note[] = Array.from({ length: count }, (_, index) => ({
  id: `note-${index}`,
  slug: `note-${index}`,
  title: index === 0 ? "Release planning" : `Note ${String(index).padStart(2, "0")}`,
  body:
    (index === 0
      ? "# Release checklist\n\nWrite the launch summary here.\n\n- [ ] Review changes\n- [ ] Update documentation\n\n```ts\nconst preserve = true;\n```"
      : `Project notes and ideas for item ${index}.`) +
    padding +
    (index === 999 ? "\n\nSearch marker past preview 999." : ""),
  tags: index % 2 ? ["ideas"] : ["release", "todo"],
  sourceCwd:
    index % 3 === 0 ? "G:/Projects/monocode" : index % 3 === 1 ? "G:/Projects/mobile" : undefined,
  sourceSessionId: index === 0 && !parameters.has("empty") ? "fixture-session" : undefined,
  createdAt: Date.now() - index * 120000,
  updatedAt: Date.now() - index * 60000,
}));
const calls: { command: string; id?: string; query?: string; bytes?: number }[] = [];
const imagePickerControl = { finish: null as null | (() => void) };
Object.assign(window, {
  imagePickerControl,
  notesFixture: notes,
  notesFixtureCalls: calls,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (
      command: string,
      args: { note?: NoteUpsert; id?: string; query?: string } = {},
    ) => {
      if (command.startsWith("notes_")) calls.push({ command, id: args.id, query: args.query });
      if (command === "plugin:dialog|open") {
        return new Promise<null>((resolve) => {
          imagePickerControl.finish = () => resolve(null);
        });
      }
      if (command === "notes_list") return structuredClone(notes);
      if (command === "notes_list_summaries") {
        const summaries = notes.map(summarizeNote);
        calls.at(-1)!.bytes = new TextEncoder().encode(JSON.stringify(summaries)).byteLength;
        return summaries;
      }
      if (command === "notes_get")
        return structuredClone(notes.find((note) => note.id === args.id) ?? null);
      if (command === "notes_search") {
        const query = String(args.query).toLocaleLowerCase();
        return notes
          .filter((note) =>
            `${note.title} ${note.body} ${note.slug}`.toLocaleLowerCase().includes(query),
          )
          .map((note) => note.id);
      }
      if (command === "notes_upsert") {
        const index = notes.findIndex((note) => note.id === args.note!.id);
        const saved = {
          ...(index >= 0 ? notes[index] : { createdAt: Date.now(), slug: args.note!.id }),
          ...args.note!,
          title: args.note!.title || "Untitled",
          updatedAt: Date.now(),
        } as Note;
        if (index >= 0) notes[index] = saved;
        else notes.unshift(saved);
        return structuredClone(saved);
      }
      if (command === "notes_delete") {
        const index = notes.findIndex((note) => note.id === args.id);
        if (index >= 0) notes.splice(index, 1);
        return;
      }
      if (command === "plugin:event|listen") return 1;
      if (command.includes("is_maximized") || command.includes("is_fullscreen")) return false;
      return null;
    },
  },
});
await setLanguagePreference(
  new URLSearchParams(location.search).get("lang") === "tr" ? "tr" : "en",
);
function Fixture() {
  const [panel, setPanel] = useState(parameters.has("panel"));
  useEffect(() => {
    const open = () => setPanel(false);
    window.addEventListener(OPEN_NOTE_LIBRARY_EVENT, open);
    return () => window.removeEventListener(OPEN_NOTE_LIBRARY_EVENT, open);
  }, []);
  return panel ? (
    <SessionNotesPanel sessionId="fixture-session" cwd="G:/Projects/monocode" />
  ) : (
    <NotesView
      besideRail
      cwd="G:/Projects/monocode"
      recents={[
        { path: "G:/Projects/monocode", openedAt: 2 },
        { path: "G:/Projects/mobile", openedAt: 1 },
      ]}
      onClose={() => {}}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <div
      style={{ blockSize: "100dvh", display: "flex", background: "var(--color-background-base)" }}
    >
      <Fixture />
    </div>
  </QueryClientProvider>,
);
