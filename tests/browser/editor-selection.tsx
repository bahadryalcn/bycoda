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
const readability = searchFixture.get("readability");
const readabilityDoc =
  readability === "css"
    ? ':root {\n  --brand: #aabbcc;\n  --space: 8px;\n}\na {\n  color: var(--br);\n  background: rgb(12, 34, 56);\n  border-color: red;\n  animation-name: red-spinner;\n  font-family: "red apple";\n}\n'
    : readability === "log"
      ? "[12:00] ERROR connection failed\nINFO ready\nWARN retry\nSUCCESS connected\n"
      : readability === "html"
        ? '<div data-example="--fake: red;">--outside: red;</div>\n<style>\n:root { --real: blue; }\na { color: var(--re); }\n</style>'
        : readability === "large"
          ? Array.from(
              { length: 300 },
              (_, i) =>
                `function block${i}() {\n  // TODO: block${i}\n  return [{ value: (${i}) }];\n}\n`,
            ).join("\n")
          : 'function render() {\n  // ! Keep the error visible\n  // TODO: add a loading state\n  const text = "[not a bracket]";\n  return (\n    <section>\n      <span>{text}</span>\n    </section>\n  );\n}\n';
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
          path={
            readability === "css"
              ? "/fixture/src/theme.css"
              : readability === "log"
                ? "/fixture/server.log"
                : readability === "html"
                  ? "/fixture/src/index.html"
                  : readability
                    ? "/fixture/src/value.tsx"
                    : "/fixture/src/value.ts"
          }
          cwd="/fixture"
          commentPath="src/value.ts"
          value={
            readability
              ? readabilityDoc
              : searchMode
                ? searchDoc
                : "const first = 1;\nconst second = 2;\nconsole.log(first + second);\n"
          }
          showDiff={searchMode === "split" || searchMode === "inline"}
          gitOriginal={
            searchMode
              ? readability
                ? readabilityDoc.replace("loading state", "pending state")
                : searchDoc.replaceAll(" = ", " = 1 + ")
              : null
          }
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
