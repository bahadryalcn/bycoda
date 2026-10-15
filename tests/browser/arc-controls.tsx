import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/shared/ui/Button";
import { TextField } from "../../src/shared/ui/TextField";
import { TextareaField } from "../../src/shared/ui/TextareaField";
import checkoutStyles from "../../src/features/source-control/ui/CheckoutHeader.module.css";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { SearchInput, SearchInputGroup } from "../../src/shared/ui/SearchInput";
import { Combobox } from "../../src/shared/ui/arc/combobox/combobox";
import { Search } from "../../src/shared/ui/icons";
import { MorphSelect } from "../../src/shared/ui/MorphSelect";
import { ExpandableCard } from "../../src/shared/ui/ExpandableCard";
import { Timeline } from "../../src/shared/ui/Timeline";
import { JsonViewer } from "../../src/shared/ui/JsonViewer";
import { FilterToolbar } from "../../src/shared/ui/FilterToolbar";
import { SortableDataTable } from "../../src/shared/ui/SortableDataTable";
import { DateRangePicker, type DateRange } from "../../src/shared/ui/DateRangePicker";
import { InlineEdit } from "../../src/shared/ui/InlineEdit";
import { UsageMeter } from "../../src/shared/ui/UsageMeter";
import { ConfirmMorph } from "../../src/shared/ui/ConfirmMorph";
import { ShortcutEditor } from "../../src/features/settings/ui/ShortcutSettings";
import { ImageLightbox } from "../../src/shared/ui/ImageLightbox";
import { setLanguagePreference } from "../../src/shared/i18n";
import {
  Group,
  Row,
  Segmented,
  Slider,
  Toggle,
  Select,
} from "../../src/features/settings/ui/settingsControls";
import "../../src/styles/index.css";
import "../../src/features/host-tools/host-tools.css";
import "../../src/features/host-tools/runtime-logs.css";

// Local, memory-only controls: no project, account, host or policy writes.
function SearchClearFixture() {
  const [inline, setInline] = useState("");
  const [standalone, setStandalone] = useState("");
  const [logs, setLogs] = useState("");
  return (
    <section aria-label="Search clear controls" className="my-4 grid gap-3">
      <SearchInputGroup className="relative flex h-7 min-w-0 items-center rounded-md border border-stroke px-2">
        <Search className="size-3 shrink-0" />
        <SearchInput
          aria-label="Inline search"
          focusOwner="group"
          value={inline}
          onChange={(event) => setInline(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-2 text-[12px]"
        />
      </SearchInputGroup>
      <label>
        <span className="sr-only">Standalone search</span>
        <SearchInput
          standalone
          type="search"
          aria-label="Standalone search"
          value={standalone}
          onChange={(event) => setStandalone(event.target.value)}
          className="h-7 rounded-md border border-stroke bg-transparent px-2 text-[12px]"
        />
      </label>
      <div className="host-tools host-tools-content runtime-logs-panel">
        <SearchInputGroup className="runtime-logs-search">
          <Search size={15} />
          <SearchInput
            type="search"
            focusOwner="group"
            aria-label="Fixture log search"
            value={logs}
            onChange={(event) => setLogs(event.target.value)}
          />
        </SearchInputGroup>
      </div>
      <div className="bycoda-arc">
        <Combobox label="Focus combobox" options={[{ value: "one", label: "First" }]} />
      </div>
    </section>
  );
}

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
        <SearchClearFixture />
        <section aria-label="Field focus" className="grid gap-3">
          <TextField label="Focus input" />
          <TextField label="Invalid focus input" error="Required" />
          <TextareaField
            label="Commit message"
            hideLabel
            fieldClassName={checkoutStyles.messageField}
            className={checkoutStyles.message}
            rows={1}
            defaultValue={"Long commit message ".repeat(30)}
          />
          <TextareaField label="Invalid focus textarea" error="Required" />
          <TextareaField label="Disabled focus textarea" disabled />
          <Button>After focus fields</Button>
        </section>
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
              clearable
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
        <AdditionalControls />
        <ButtonApiControls />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

function ButtonApiControls() {
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  return (
    <section aria-label="Shared button API" className="mt-6 grid min-w-0 gap-3">
      <h2 className="text-lg font-medium">Shared buttons</h2>
      <div className="flex flex-wrap items-center gap-2">
        {(["primary", "secondary", "ghost", "danger", "link"] as const).map((variant) => (
          <Button key={variant} variant={variant} onClick={() => setCount((value) => value + 1)}>
            {variant}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label="Button API filters"
          shape="pill"
          selected={selected}
          aria-pressed={selected}
          aria-haspopup="dialog"
          aria-expanded={popupOpen}
          onClick={() => {
            setSelected(!selected);
            setPopupOpen(!popupOpen);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 3h10M4 7h6M6 11h2" stroke="currentColor" />
          </svg>
        </Button>
        <Button size="md" iconOnly label="Medium button">
          <span aria-hidden="true">+</span>
        </Button>
        <Button size="lg" iconOnly label="Large button">
          <span aria-hidden="true">+</span>
        </Button>
      </div>
      {popupOpen ? <output aria-label="Button popup result">Opened</output> : null}
      <Button variant="item" onClick={() => setCount((value) => value + 1)}>
        <div data-direct-row>Project row with long content that wraps in a narrow panel</div>
      </Button>
      <div role="tablist" aria-label="Button API tabs" className="flex gap-2">
        <Button variant="tab" role="tab" aria-selected={true} tabIndex={0}>
          Selected tab
        </Button>
        <Button variant="tab" role="tab" aria-selected={false} tabIndex={-1}>
          Other tab
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          loading={busy}
          loadingLabel="Saving action"
          onClick={() => setCount((value) => value + 1)}
        >
          Animated action
        </Button>
        <Button
          motion="none"
          loading={busy}
          loadingLabel="Saving native action"
          onClick={() => setCount((value) => value + 1)}
        >
          Native action
        </Button>
        <Button variant="ghost" aria-disabled="true" onClick={() => setCount((value) => value + 1)}>
          Unavailable action
        </Button>
        <Button onClick={() => setBusy(!busy)}>Toggle pending</Button>
      </div>
      <output aria-label="Button action count">{count}</output>
    </section>
  );
}

function AdditionalControls() {
  const [filters, setFilters] = useState([
    { id: "project", label: "Project", value: "bycoda" },
    { id: "tag", label: "Tag", value: "review" },
  ]);
  const [range, setRange] = useState<DateRange | null>(null);
  const [name, setName] = useState("Review notes");
  const [failSave, setFailSave] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [shortcut, setShortcut] = useState<string | null>("Ctrl+K");
  const [imageOpen, setImageOpen] = useState(false);
  const image =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="gray"/><circle cx="400" cy="300" r="150" fill="white"/></svg>',
    );
  return (
    <section className="mt-6 grid min-w-0 gap-4" aria-label="Additional Arc controls">
      <h2 className="text-lg font-medium">Data and actions</h2>
      <Button onClick={() => setLanguagePreference("tr")}>Türkçe controls</Button>
      <JsonViewer
        data={{
          account: "local fixture",
          items: Array.from({ length: 60 }, (_, index) => ({ index, status: "ready" })),
        }}
        label="Saved tool output"
        pageSize={10}
        writeText={async (text) => {
          await navigator.clipboard.writeText(text);
        }}
      />
      <FilterToolbar
        filters={filters}
        onRemove={(id) => setFilters((current) => current.filter((filter) => filter.id !== id))}
        onClearAll={() => setFilters([])}
      />
      <SortableDataTable
        caption="Project usage"
        rowKey="id"
        rows={[
          { id: "a", project: "Alpha", cost: 10 },
          { id: "b", project: "Beta", cost: 2 },
        ]}
        columns={[
          { key: "project", label: "Project", sortable: true },
          { key: "cost", label: "Cost", sortable: true, numeric: true },
        ]}
      />
      <div>
        <DateRangePicker value={range} onChange={setRange} />
        <output aria-label="Applied range">
          {range
            ? `${range.start.toLocaleDateString()} – ${range.end.toLocaleDateString()}`
            : "No range"}
        </output>
      </div>
      <InlineEdit
        label="Note title"
        value={name}
        onSave={async (next) => {
          if (failSave) throw new Error("Save rejected");
          setName(next);
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={failSave}
          onChange={(event) => setFailSave(event.currentTarget.checked)}
        />
        Reject next rename
      </label>
      <UsageMeter
        label="Account quota"
        segments={[{ id: "used", label: "Used", value: 72 }]}
        limit={100}
        unit="%"
        decimals={0}
      />
      <ShortcutEditor
        name="fixture"
        display={shortcut}
        resetVisible={shortcut !== "Ctrl+K"}
        onApply={setShortcut}
        onDisable={() => setShortcut(null)}
        onReset={() => setShortcut("Ctrl+K")}
      />
      <div>
        <ConfirmMorph
          label="Delete fixture note"
          prompt="Delete this note?"
          onConfirm={async () => setDeleted(true)}
        />
        <output aria-label="Deletion result">{deleted ? "Deleted" : "Retained"}</output>
      </div>
      <Button onClick={() => setImageOpen(true)}>Open image comparison</Button>
      {imageOpen ? (
        <ImageLightbox src={image} alt="Original fixture" onClose={() => setImageOpen(false)} />
      ) : null}
    </section>
  );
}
