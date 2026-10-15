import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodeMirrorEditor } from "../../src/features/files/ui/CodeMirrorEditor";
import {
  ADD_TO_CHAT_EVENT,
  appendComposerInsert,
  type AddToChatRequest,
} from "../../src/features/sessions/model/quoteDraft";
import "../../src/styles/index.css";

localStorage.setItem("bycoda.autosave", "0");
const searchFixture = new URLSearchParams(location.search);
const searchMode = searchFixture.get("search");
if (searchMode)
  localStorage.setItem("bycoda.diffLayout", searchMode === "split" ? "split" : "unified");
const searchDoc = Array.from({ length: 300 }, (_, index) => `const value${index} = ${index};`).join(
  "\n",
);

function Fixture() {
  const [draft, setDraft] = useState("Explain this code");
  useEffect(() => {
    const add = (event: Event) => {
      const { text } = (event as CustomEvent<AddToChatRequest>).detail;
      setDraft((value) => appendComposerInsert(value, text));
    };
    window.addEventListener(ADD_TO_CHAT_EVENT, add);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, add);
  }, []);
  return (
    <main className="grid h-dvh grid-rows-[1fr_auto] gap-4 bg-background-base p-6 text-content">
      <section className="relative flex min-h-0 overflow-hidden rounded-xl border border-content/10">
        <CodeMirrorEditor
          path="/fixture/src/value.ts"
          cwd="/fixture"
          commentPath="src/value.ts"
          value={
            searchMode
              ? searchDoc
              : "const first = 1;\nconst second = 2;\nconsole.log(first + second);\n"
          }
          showDiff={searchMode === "split" || searchMode === "inline"}
          gitOriginal={searchMode ? searchDoc.replaceAll(" = ", " = 1 + ") : null}
          active
          onSave={() => {}}
          onDirtyChange={() => {}}
          onErrorCountChange={() => {}}
          canAutosave={() => false}
        />
      </section>
      <textarea
        aria-label="Chat draft"
        className="h-28 rounded-xl border border-content/10 p-3"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
