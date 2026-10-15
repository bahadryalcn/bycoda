import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionHostTools } from "../../src/features/host-tools/SessionHostTools";
import { Composer } from "../../src/features/sessions/ui/Composer";
import { setLanguagePreference, setDomainLanguagePreference } from "../../src/shared/i18n";
import type { Attachment } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

const language = new URLSearchParams(location.search).get("lang") === "tr" ? "tr" : "en";
await setLanguagePreference(language);
await setDomainLanguagePreference("technical", language);
const record = { sent: 0, submitted: [] as Attachment[] };
Object.assign(window, { annotationFixture: record });
function Fixture() {
  const [target, setTarget] = useState("a");
  const cwd = `remote://fixture/project-${target}`;
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 12,
        minInlineSize: 0,
        color: "var(--color-content)",
        background: "var(--color-background-base)",
      }}
    >
      <button type="button" onClick={() => setTarget((current) => (current === "a" ? "b" : "a"))}>
        Switch project and session
      </button>
      <section aria-label="Target composer">
        <Composer
          key={cwd}
          cwd={cwd}
          executionCwd={cwd}
          sessionId={`shell-${target}`}
          focused={false}
          harness="codex"
          model=""
          runtimeMode="supervised"
          hideTopBar
          initialDraft="Please adjust this"
          onFocus={() => {}}
          onCwdChange={() => {}}
          onModelChange={() => {}}
          onRuntimeModeChange={() => {}}
          onSubmit={(_text, files) => {
            record.sent++;
            record.submitted = files;
            return true;
          }}
        />
      </section>
      <div style={{ blockSize: 860, minInlineSize: 0 }}>
        <SessionHostTools
          key={cwd}
          cwd={cwd}
          sessionId={`host-${target}`}
          composerSessionId={`shell-${target}`}
          title={`Conversation ${target}`}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
