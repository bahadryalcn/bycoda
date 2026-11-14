import { WindowControls } from "../../../src/app/shell/WindowControls";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PromptOutline } from "../../../src/features/sessions/ui/PromptOutline";
import { TranscriptFind } from "../../../src/features/sessions/ui/TranscriptFind";
import { ProjectQuickActions } from "../../../src/features/projects/ui/ProjectQuickActions";
import type { ExpandingButtonGroupItem } from "../../../src/shared/ui/ButtonGroup";
import { File, X } from "../../../src/shared/ui/icons";
import type { Block } from "../../../src/features/sessions/model/session";
import "../../../src/styles/index.css";
import { SessionProviderGoal } from "../../../src/features/sessions/ui/SessionProviderGoal";
import type { SessionGoal } from "../../../src/features/sessions/model/providerGoal";
import { PromptField } from "../../../src/shared/ui/PromptField";
import { Text } from "../../../src/shared/ui/Text";
import { setLanguagePreference } from "../../../src/shared/i18n";

const params = new URLSearchParams(location.search);
if (params.has("tr")) setLanguagePreference("tr");
document.documentElement.classList.toggle("dark", params.has("dark"));
document.documentElement.classList.toggle("theme-light", !params.has("dark"));
const blocks: Block[] = Array.from({ length: Number(params.get("count") ?? 120) }, (_, i) => ({
  id: `prompt-${i}`,
  role: "user",
  text: `Prompt ${i}`,
}));
if (params.has("preview")) {
  blocks[0].text = "duruma bakarmısın çalışıyorlar bir kaç tane uzun konuşma başlığı";
  blocks.splice(1, 0, {
    id: "reply-0",
    role: "assistant",
    text: "Failed to authenticate: OAuth session\nexpired and could not be refreshed",
  });
}

function Fixture() {
  const scope = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [find, setFind] = useState<ExpandingButtonGroupItem | null>(null);
  const [notes, setNotes] = useState(false);
  const [closed, setClosed] = useState(false);
  const [goal, setGoal] = useState<SessionGoal | undefined>({
    provider: "codex",
    providerSessionId: "fixture-codex",
    objective: params.has("long")
      ? "Hesapları ve seçili modeli doğrula 👨‍👩‍👧‍👦 مرحبا ".repeat(80)
      : "Ödeme, rapor erişimi ve demo seed doğrulamalarındaki açık işleri tamamla.",
    status: (params.get("goal") || "blocked") as SessionGoal["status"],
    tokensUsed: 12400,
    tokenBudget: 50000,
    timeUsedSeconds: 376,
  });
  const [draft, setDraft] = useState("Taslağım burada kalmalı.");
  if (params.has("goal"))
    return (
      <main className="flex h-dvh flex-col bg-(--ui-surface) text-(--ui-text-primary)">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 p-4">
          <Text weight="medium">Değişikliklerde Hata ve Eksikler</Text>
          <Text tone="secondary">
            Kaldığım yerden devam ediyorum. Ödeme, rapor erişimi ve demo seed doğrulamalarını
            kontrol ediyorum.
          </Text>
        </div>
        <div className="mx-auto w-full max-w-4xl p-4">
          {params.has("busy") ? (
            <Text size="caption" tone="secondary" className="px-4 py-2">
              Working · 3 running
            </Text>
          ) : null}
          <SessionProviderGoal
            session={{
              harness: "codex",
              providerSessionId: "fixture-codex",
              providerGoal: goal,
              busy: params.has("busy"),
            }}
            onCommand={(command) => {
              if (params.has("reject")) return false;
              setGoal(
                command === "/goal clear" ? undefined : goal && { ...goal, status: "active" },
              );
              return true;
            }}
          />
          <PromptField
            label="Message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </main>
    );
  return (
    <main className="flex h-dvh flex-col bg-(--ui-surface) text-(--ui-text-primary)">
      <header
        className="flex shrink-0 justify-end p-2"
        onPointerDown={() => {
          throw new Error("Toolbar started pane drag");
        }}
      >
        <ProjectQuickActions
          cwd="C:/project"
          onRun={() => undefined}
          additionalItems={[
            ...(find ? [find] : []),
            { id: "notes", label: "Notes", icon: <File />, onSelect: () => setNotes(true) },
            { id: "close", label: "Close pane", icon: <X />, onSelect: () => setClosed(true) },
          ]}
        />
        {params.has("caption") ? <WindowControls /> : null}
      </header>
      <div ref={scope} data-outline-scope className="@container relative min-h-0 flex-1">
        <div ref={setScroller} className="agent-transcript h-full overflow-auto">
          {blocks.map((block) => (
            <div
              key={block.id}
              className="transcript-turn h-20"
              data-prompt-anchor={block.role === "user" ? block.id : undefined}
            >
              {block.text}
            </div>
          ))}
        </div>
        <PromptOutline blocks={blocks} scope={scope} scroller={scroller} />
        <TranscriptFind
          blocks={blocks}
          visible
          focused
          onNavigate={() => true}
          onTriggerChange={setFind}
        />
      </div>
      <output>
        {notes ? "Notes opened" : ""}
        {closed ? "Pane closed" : ""}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
