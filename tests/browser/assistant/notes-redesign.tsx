import { createRoot } from "react-dom/client";
import { useState } from "react";
import { NoteEditor } from "../../../src/features/assistant/ui/AssistantNoteEditor";
import type {
  AssistantNote,
  AssistantRequest,
  AssistantResponse,
} from "../../../src/shared/model/host-contracts/assistant";
import { Button } from "../../../src/shared/ui/Button";
import { setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
document.documentElement.dataset.canvasBackground = "pure";
await setLanguagePreference("en");
const initial: AssistantNote = {
  id: "notes-redesign",
  title: "Launch review · Friday",
  tags: ["assistant"],
  createdAt: 1,
  updatedAt: 2,
  body: "# Release review\n\nKeep the owner's decisions, source links and unfinished work together.\n\n## Before the next build\n\n- [x] Review the working changes\n- [ ] Verify the voice handoff on the original computer\n\n> Keep a draft open while its save is being verified.\n\n| Area | Next step |\n| --- | --- |\n| Voice | Confirm reconnect behavior |\n| Notes | Keep exact Markdown |\n\n```ts\nconst outcome = await saveNote(draft);\n```\n\n[Release notes](https://example.com/release) · Türkçe notlar · 日本語 · العربية",
};
function Fixture() {
  const [note, setNote] = useState(initial);
  const [open, setOpen] = useState(true);
  const request = async (input: AssistantRequest): Promise<AssistantResponse> => {
    if (params.has("fail")) throw new Error("The connection was interrupted.");
    if (input.op === "notes.save") {
      const saved = { ...note, title: input.title, body: input.body, updatedAt: 3 };
      setNote(saved);
      return { note: saved };
    }
    return { note };
  };
  return (
    <main className="mx-auto max-w-6xl p-4">
      {open ? (
        <NoteEditor
          note={params.has("new") ? "new" : note}
          environmentId="fixture-notes-host"
          request={request}
          onSaved={async () => {}}
          onClose={() => setOpen(false)}
        />
      ) : (
        <Button onClick={() => setOpen(true)}>Reopen note</Button>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
