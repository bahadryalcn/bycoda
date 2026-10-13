import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/shared/ui/Button";
import { TextField } from "../../src/shared/ui/TextField";
import { TextareaField } from "../../src/shared/ui/TextareaField";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { MorphSelect } from "../../src/shared/ui/MorphSelect";
import { ExpandableCard } from "../../src/shared/ui/ExpandableCard";
import { Timeline } from "../../src/shared/ui/Timeline";
import {
  Group,
  Row,
  Segmented,
  Slider,
  Toggle,
  Select,
} from "../../src/features/settings/ui/settingsControls";
import "../../src/styles/index.css";

// Local, memory-only controls: no project, account, host or policy writes.
function Fixture() {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(50);
  const [density, setDensity] = useState("compact");
  const [query, setQuery] = useState("");
  const [light, setLight] = useState(false);
  const [choice, setChoice] = useState("one");
  const options = [
    { value: "one", label: "First" },
    { value: "two", label: "Second" },
  ];
  return (
    <main className="h-full overflow-auto p-6 text-content">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-medium">bycoda controls</h1>
        <div className="my-4 flex gap-2">
          <Button
            onClick={() => {
              document.documentElement.classList.toggle("theme-light", !light);
              setLight(!light);
            }}
          >
            {light ? "Dark theme" : "Light theme"}
          </Button>
          <Button disabled>Unavailable</Button>
          <Button loading>Saving</Button>
        </div>
        <Group title="Appearance" layout="full">
          <Row label="Enable sounds">
            <Toggle label="Enable sounds" on={enabled} onChange={setEnabled} />
          </Row>
          <Row label="Unavailable setting">
            <Toggle label="Unavailable setting" on={false} onChange={() => {}} disabled />
          </Row>
          <Row label="Opacity">
            <Slider
              label="Opacity"
              value={opacity}
              display={`${opacity}%`}
              min={0}
              max={100}
              step={1}
              onChange={setOpacity}
            />
          </Row>
          <Row label="Density">
            <Segmented
              label="Density"
              value={density}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
              ]}
              onChange={setDensity}
              optionIdPrefix="setting-density"
            />
          </Row>
          <Row label="Filter notes">
            <TextField
              label="Filter notes"
              hideLabel
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Row>
        </Group>
        <Group title="Selection" layout="full">
          <Row label="Standard choice">
            <Select label="Standard choice" value={choice} options={options} onChange={setChoice} />
          </Row>
          <Row label="Search choice">
            <SearchableSelect
              label="Search choice"
              value={choice}
              options={options}
              onChange={setChoice}
            />
          </Row>
          <Row label="Property choice">
            <MorphSelect
              label="Property choice"
              value={choice}
              options={options}
              onChange={setChoice}
            />
          </Row>
        </Group>
        <ExpandableCard title="Draft details">
          <TextareaField label="Retained draft" rows={3} />
        </ExpandableCard>
        <Timeline
          label="Attempt outcomes"
          now={1_800_000_000_000}
          events={[
            {
              id: "attempt",
              at: 1_799_999_900_000,
              title: "Completed attempt",
              detail: "Review summary",
              actions: <Button>Open attempt</Button>,
            },
          ]}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
