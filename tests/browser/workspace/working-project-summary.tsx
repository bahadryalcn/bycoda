import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveAgentsPreview } from "../../../src/features/sessions/ui/LiveAgentsPreview";
import type { LiveAgent } from "../../../src/features/sessions/model/liveAgents";
import { Button } from "../../../src/shared/ui/Button";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { languageReady } from "../../../src/shared/i18n";
import "./working-project-summary.css";

const parameters = new URLSearchParams(location.search);
applyThemePreference(parameters.has("light") ? "light" : "dark");
const startedAt = Date.now() - 195000;
const agents: LiveAgent[] = [
  ...[1, 2, 3].map((id) => ({
    id: `x-${id}`,
    cwd: "/project/x",
    title: `Current project session ${id}`,
    harness: "codex" as const,
    activity: "Working",
    startedAt,
    needsApproval: false,
    done: false,
  })),
  ...[1, 2].map((id) => ({
    id: `y-${id}`,
    cwd: "/project/y",
    title: `Other project session ${id}: preserve exact navigation`,
    harness: "codex" as const,
    activity: "Working",
    startedAt,
    needsApproval: false,
    done: false,
  })),
];
function Fixture() {
  const [project, setProject] = useState("/project/x");
  const [selected, setSelected] = useState("");
  const currentOnly = parameters.has("currentOnly");
  const source = currentOnly ? agents.filter((agent) => agent.cwd === "/project/x") : agents;
  return (
    <main className="min-h-screen bg-(--color-background-base) p-6 text-(--ui-text-primary)">
      <div className="mb-6 flex gap-2">
        <Button onClick={() => setProject("/project/x")}>Project X</Button>
        <Button onClick={() => setProject("/project/y")}>Project Y</Button>
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <aside
          data-fixture="rail"
          className="@container/rail w-[360px] max-w-full border-x border-t border-(--ui-pane-border) p-2"
        >
          <p className="mb-4 text-ui-secondary">
            Project {project.endsWith("x") ? "X" : "Y"} sessions shown above
          </p>
          <LiveAgentsPreview
            agents={source}
            currentProject={project}
            collapsible={!parameters.has("noncollapsible")}
            activeSessionId={selected}
            onSelect={setSelected}
          />
        </aside>
        <aside
          data-fixture="sidebar"
          className="@container/rail w-[360px] max-w-full border-x border-t border-(--ui-pane-border) p-2"
        >
          <p className="mb-4 text-ui-secondary">Sidebar Working band</p>
          <LiveAgentsPreview
            agents={source}
            currentProject={project}
            collapsible={!parameters.has("noncollapsible")}
            activeSessionId={selected}
            onSelect={setSelected}
          />
        </aside>
      </div>
      <output data-selected>{selected}</output>
    </main>
  );
}
await languageReady;
createRoot(document.getElementById("root")!).render(<Fixture />);
