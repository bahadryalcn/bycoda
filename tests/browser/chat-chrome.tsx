import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PromptOutline } from "../../src/features/sessions/ui/PromptOutline";
import { TranscriptFind } from "../../src/features/sessions/ui/TranscriptFind";
import { ProjectQuickActions } from "../../src/features/projects/ui/ProjectQuickActions";
import type { ExpandingButtonGroupItem } from "../../src/shared/ui/ExpandingButtonGroup";
import { File, X } from "../../src/shared/ui/icons";
import type { Block } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.has("dark"));
const blocks: Block[] = Array.from({ length: Number(params.get("count") ?? 120) }, (_, i) => ({
  id: `prompt-${i}`,
  role: "user",
  text: `Prompt ${i}`,
}));

function Fixture() {
  const scope = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [find, setFind] = useState<ExpandingButtonGroupItem | null>(null);
  const [notes, setNotes] = useState(false);
  const [closed, setClosed] = useState(false);
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
          additionalItems={[
            ...(find ? [find] : []),
            { id: "notes", label: "Notes", icon: <File />, onSelect: () => setNotes(true) },
            { id: "close", label: "Close pane", icon: <X />, onSelect: () => setClosed(true) },
          ]}
        />
      </header>
      <div ref={scope} data-outline-scope className="@container relative min-h-0 flex-1">
        <div ref={setScroller} className="agent-transcript h-full overflow-auto">
          {blocks.map((block) => (
            <div key={block.id} className="transcript-turn h-20" data-prompt-anchor={block.id}>
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
