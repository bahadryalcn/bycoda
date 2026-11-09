import { createRoot } from "react-dom/client";
import { Button } from "../../src/shared/ui/Button";
import { OverflowTooltip } from "../../src/shared/ui/Tooltip";
import { Select } from "../../src/shared/ui/Select";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { MiddleTruncate } from "../../src/shared/ui/MiddleTruncate";
import { ShortcutKeys } from "../../src/shared/ui/ShortcutKbd";
import { DateRangePicker } from "../../src/shared/ui/DateRangePicker";
import { FloatingButtonGroup } from "../../src/shared/ui/FloatingButtonGroup";
import { ExpandingButtonGroup } from "../../src/shared/ui/ExpandingButtonGroup";
import { ActivityPhases } from "../../src/features/sessions/ui/AgentTranscriptActivity";
import type { Block } from "../../src/features/sessions/model/session";
import { Copy, Search } from "../../src/shared/ui/icons";
import { setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";
import "../../src/features/sessions/ui/chat-controls.css";

setLanguagePreference("en");
const long =
  "A very long readable control label that only deserves a tooltip when the available space clips its content";
const path =
  "G:/Projects/my_projects/upstream/src/features/sessions/ui/AgentTranscriptActivity.tsx";
const blocks: Block[] = [
  {
    id: "search",
    role: "tool",
    text: "Search project",
    tool: {
      kind: "search",
      title: "Search project",
      status: "completed",
      preview: { kind: "search", query: "tooltip" },
    },
  },
  ...["one", "two"].map((id) => ({
    id,
    role: "tool" as const,
    text: "echo fixture",
    tool: { kind: "shell", title: "echo fixture", status: "completed" },
  })),
];

function Fixture() {
  return (
    <main
      style={{
        padding: 24,
        color: "var(--ui-text-primary)",
        background: "var(--ui-surface)",
        minHeight: "100vh",
      }}
    >
      <style>{`.policy-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.policy-card{min-width:0;padding:16px;border:1px solid var(--ui-border);border-radius:8px}.policy-card h2{margin-bottom:12px;font-weight:600}.policy-stack{display:flex;flex-direction:column;align-items:flex-start;gap:12px}.responsive-label{display:inline}@media(max-width:900px){.responsive-label{display:none}}`}</style>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Tooltip policy · real shared controls</h1>
      <div className="policy-grid">
        <section className="policy-card" aria-label="Basic hints">
          <h2>Visible text and useful hints</h2>
          <div className="policy-stack">
            <Button data-testid="visible" tooltip="Explorer" tooltipWhen="overflow">
              Explorer
            </Button>
            <Button
              data-testid="clipped"
              tooltip={long}
              tooltipWhen="overflow"
              style={{ width: 180 }}
            >
              <span className="min-w-0 truncate">{long}</span>
            </Button>
            <OverflowTooltip label={long}>
              <span data-testid="multiline" style={{ width: 180 }} className="line-clamp-2">
                {long}
              </span>
            </OverflowTooltip>
            <Button data-testid="icon" iconOnly label="Search workspace">
              <Search />
            </Button>
            <Button data-testid="responsive" tooltip="Responsive Explorer" tooltipWhen="overflow">
              <Search />
              <span className="responsive-label">Responsive Explorer</span>
            </Button>
            <Button
              data-testid="details"
              tooltip="Details"
              tooltipWhen="overflow"
              tooltipDetails={["Includes nested folders"]}
            >
              Details
            </Button>
            <Button
              data-testid="disabled"
              disabled
              disabledReason="Choose a project first"
              tooltipWhen="overflow"
            >
              Start
            </Button>
            <Button
              data-testid="shortcut"
              label="Open palette"
              shortcut="Ctrl+K"
              tooltipWhen="overflow"
            >
              Open palette
            </Button>
            <Button
              data-testid="inline-shortcut"
              tooltip="Save"
              shortcut="Ctrl+S"
              tooltipWhen="overflow"
            >
              Save <span data-tooltip-shortcut="">Ctrl+S</span>
            </Button>
            <Button
              data-testid="hidden-shortcut"
              tooltip="Hidden shortcut"
              shortcut="Ctrl+H"
              tooltipWhen="overflow"
            >
              Hidden shortcut{" "}
              <span style={{ display: "none" }}>
                <ShortcutKeys shortcut="Ctrl+H" />
              </span>
            </Button>
            <Button
              data-testid="single-letter-shortcut"
              tooltip="Sessions"
              shortcut="S"
              tooltipWhen="overflow"
            >
              Sessions
            </Button>
            <Button
              data-testid="keycap-shortcut"
              tooltip="Keycap shortcut"
              shortcut="Ctrl+L"
              tooltipWhen="overflow"
            >
              Keycap shortcut <ShortcutKeys shortcut="Ctrl+L" />
            </Button>
          </div>
        </section>
        <section className="policy-card" aria-label="Value recovery">
          <h2>Paths, select and combobox</h2>
          <div className="policy-stack">
            <div data-testid="middle-short" style={{ width: 300 }}>
              <MiddleTruncate mode="text">Explorer</MiddleTruncate>
            </div>
            <div data-testid="middle-long" style={{ width: 180 }}>
              <MiddleTruncate>{path}</MiddleTruncate>
            </div>
            <div data-testid="select-short" style={{ width: 270 }}>
              <Select
                hideLabel
                label="Short select"
                value="short"
                options={[{ value: "short", label: "Explorer" }]}
                onValueChange={() => {}}
              />
            </div>
            <div data-testid="select-long" style={{ width: 180 }}>
              <Select
                hideLabel
                label="Long select"
                value="long"
                options={[{ value: "long", label: long }]}
                onValueChange={() => {}}
              />
            </div>
            <div data-testid="searchable-short" style={{ width: 270 }}>
              <SearchableSelect
                hideLabel
                label="Short combobox"
                value="short"
                options={[{ value: "short", label: "Explorer" }]}
                onChange={() => {}}
              />
            </div>
            <div data-testid="searchable-long" style={{ width: 180 }}>
              <SearchableSelect
                hideLabel
                label="Long combobox"
                value="long"
                options={[{ value: "long", label: long }]}
                onChange={() => {}}
              />
            </div>
            <div data-testid="date-range" style={{ width: 260 }}>
              <DateRangePicker
                value={{ start: new Date(2026, 9, 1), end: new Date(2026, 9, 31) }}
              />
            </div>
          </div>
        </section>
        <section className="policy-card" aria-label="Action groups">
          <h2>Floating and expanding actions</h2>
          <div className="policy-stack">
            <FloatingButtonGroup
              label="Floating text actions"
              items={[{ id: "copy", label: "Copy fixture", icon: <Copy /> }]}
            />
            <FloatingButtonGroup
              label="Floating icon actions"
              items={[{ id: "search", label: "Find fixture", icon: <Search />, iconOnly: true }]}
            />
            <ExpandingButtonGroup
              label="Expanding actions"
              items={[{ id: "expand", label: "Copy expanded fixture", icon: <Copy /> }]}
            />
          </div>
        </section>
        <section className="policy-card" aria-label="Production consumer">
          <h2>Actual transcript activity phase</h2>
          <ActivityPhases blocks={blocks} done padded={false} />
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
