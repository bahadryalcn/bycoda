import { QuestionForm } from "../../src/features/sessions/ui/QuestionForm";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/shared/ui/Button";
import { ControlSpecimen } from "../../src/shared/ui/ControlSpecimen";
import { NativeSearchableSelect } from "../../src/shared/ui/NativeSearchableSelect";
import { Badge } from "../../src/shared/ui/Badge";
import { Alert } from "../../src/shared/ui/Alert";
import { EmptyState } from "../../src/shared/ui/EmptyState";
import { NumberField } from "../../src/shared/ui/NumberField";
import { PasswordField } from "../../src/shared/ui/PasswordField";
import { RadioGroup } from "../../src/shared/ui/RadioGroup";
import { DropdownMenu } from "../../src/shared/ui/DropdownMenu";
import { Progress } from "../../src/shared/ui/Progress";
import { Skeleton } from "../../src/shared/ui/Skeleton";
import { applyAccentColor } from "../../src/features/settings/model/appearance";
import { themePalette } from "../../src/shared/theme/palette";
import { TextField } from "../../src/shared/ui/TextField";
import { TextareaField } from "../../src/shared/ui/TextareaField";
import checkoutStyles from "../../src/features/source-control/ui/CheckoutHeader.module.css";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { SearchInput, SearchInputGroup } from "../../src/shared/ui/SearchInput";
import { Combobox } from "../../src/shared/ui/arc/combobox/combobox";
import { Search, Copy, Plus } from "../../src/shared/ui/icons";
import { ExpandingButtonGroup } from "../../src/shared/ui/ExpandingButtonGroup";
import { MorphSelect } from "../../src/shared/ui/MorphSelect";
import { ExpandableCard } from "../../src/shared/ui/ExpandableCard";
import { Timeline } from "../../src/shared/ui/Timeline";
import { JsonViewer } from "../../src/shared/ui/JsonViewer";
import { SortableDataTable } from "../../src/shared/ui/SortableDataTable";
import { DateRangePicker, type DateRange } from "../../src/shared/ui/DateRangePicker";
import { InlineEdit } from "../../src/shared/ui/InlineEdit";
import { UsageMeter } from "../../src/shared/ui/UsageMeter";
import { ConfirmMorph } from "../../src/shared/ui/ConfirmMorph";
import { ShortcutEditor } from "../../src/features/settings/ui/ShortcutSettings";
import { SettingsSearch } from "../../src/features/settings/ui/SettingsSearch";
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
function AsyncActionGroupFixture() {
  const [calls, setCalls] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const complete = useRef<((value: boolean) => void) | null>(null);
  return (
    <section aria-label="Async action group" className="my-4 grid gap-2">
      <ExpandingButtonGroup
        label="Sample note actions"
        confirmDuration={3000}
        items={[
          {
            id: "copy",
            label: "Copy sample",
            icon: <Copy />,
            doneLabel: "Copied",
            onSelect: () => {
              setCalls((value) => value + 1);
              setWaiting(true);
              return new Promise<boolean>((resolve) => {
                complete.current = resolve;
              });
            },
          },
          {
            id: "add",
            label: "Add sample",
            icon: <Plus />,
            onSelect: () => {
              setCalls((value) => value + 1);
            },
          },
        ]}
      />
      <Button
        disabled={!waiting}
        onClick={() => {
          complete.current?.(true);
          complete.current = null;
          setWaiting(false);
        }}
      >
        Complete group operation
      </Button>
      <output aria-label="Action invocations">{calls}</output>
    </section>
  );
}

function SearchClearFixture() {
  const [inline, setInline] = useState("");
  const [standalone, setStandalone] = useState("");
  const [logs, setLogs] = useState("");
  return (
    <section aria-label="Search clear controls" className="my-4 grid gap-3">
      <SearchInputGroup appearance="field">
        <Search className="size-3 shrink-0" />
        <SearchInput
          aria-label="Inline search"
          focusOwner="group"
          value={inline}
          onChange={(event) => setInline(event.target.value)}
        />
      </SearchInputGroup>
      <label>
        <span className="sr-only">Standalone search</span>
        <SearchInput
          appearance="field"
          standalone
          type="search"
          aria-label="Standalone search"
          value={standalone}
          onChange={(event) => setStandalone(event.target.value)}
        />
      </label>
      <div className="host-tools host-tools-content runtime-logs-panel">
        <SearchInputGroup appearance="field" className="runtime-logs-search">
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

function NativeSelectionFormFixture() {
  const native = useRef<HTMLSelectElement>(null);
  const [controlled, setControlled] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [changes, setChanges] = useState(0);
  const options = [
    { value: "", label: "Choose project" },
    { value: "locked", label: "Restricted project", disabled: true },
    ...Array.from({ length: 24 }, (_, index) => ({
      value: `project-${index + 1}`,
      label: `Project ${index + 1} with a long descriptive name`,
    })),
  ];
  return (
    <section aria-label="Native searchable forms" className="my-4 grid gap-2">
      <form
        id="native-searchable-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setSubmitted(`${data.get("project")}/${data.get("controlled")}`);
        }}
        onReset={() => setControlled("")}
      >
        <label htmlFor="native-project">Project for form</label>
        <NativeSearchableSelect
          id="native-project"
          label="Project for form"
          ref={native}
          name="project"
          defaultValue=""
          required
          options={options}
          triggerProps={{ "aria-label": "Search form projects" }}
          onChange={() => setChanges((count) => count + 1)}
        />
        <NativeSearchableSelect
          label="Controlled project for form"
          name="controlled"
          value={controlled}
          required
          options={options}
          triggerProps={{ "aria-label": "Search controlled form projects" }}
          onChange={(event) => setControlled(event.currentTarget.value)}
        />
        <Button type="submit">Submit selection form</Button>
        <Button type="reset">Reset selection form</Button>
      </form>
      <Button onClick={() => native.current?.focus()}>Focus native selection ref</Button>
      <Button onClick={() => native.current?.setCustomValidity("Choose an allowed project")}>
        Set native selection error
      </Button>
      <Button onClick={() => native.current?.setCustomValidity("")}>
        Clear native selection error
      </Button>
      <output aria-label="Submitted selection form">{submitted}</output>
      <output aria-label="Native selection changes">{changes}</output>
    </section>
  );
}

function FeedbackFixture() {
  const [failed, setFailed] = useState(false);
  const [retries, setRetries] = useState(0);
  const [loading, setLoading] = useState(true);
  return (
    <section aria-label="Shared feedback" className="my-4 grid gap-2">
      <div className="flex flex-wrap gap-2">
        {(["neutral", "info", "success", "warning", "danger"] as const).map((tone) => (
          <Badge key={tone} tone={tone} data-testid={`feedback-${tone}`}>
            {tone} status with a long label that can wrap on narrow screens
          </Badge>
        ))}
      </div>
      <Button onClick={() => setFailed((value) => !value)}>Toggle feedback failure</Button>
      <Alert
        tone={failed ? "danger" : "info"}
        title={failed ? "Operation failed" : "Operation ready"}
      >
        {failed ? "Retry the operation to continue." : "The operation can start when requested."}
      </Alert>
      <EmptyState
        title="No matching records"
        description="Change the collection filters or retry the request. The current draft is retained."
        action={
          <Button onClick={() => setRetries((value) => value + 1)}>Retry fixture request</Button>
        }
      />
      <output aria-label="Feedback retry count">{retries}</output>
      <Progress aria-label="Quota limit used" value={100} tone="danger" compact />
      <Progress aria-label="Waiting for fixture" />
      <Button onClick={() => setLoading(false)}>Complete fixture loading</Button>
      <Skeleton label="Loading fixture records" loading={loading} lines={2}>
        <Button onClick={() => setRetries((value) => value + 1)}>Retry loaded fixture</Button>
      </Skeleton>
    </section>
  );
}

function FieldFamiliesFixture() {
  const [saved, setSaved] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const menu = useRef<HTMLButtonElement>(null);
  return (
    <section aria-label="Shared field families" className="my-4 grid gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setSaved(`${data.get("amount")}/${data.get("secret")}/${data.get("approval")}`);
        }}
      >
        <NumberField
          label="Fixture limit"
          name="amount"
          defaultValue="10"
          min={1}
          max={20}
          step={1}
          required
        />
        <PasswordField
          label="Fixture credential"
          description="This credential is used only by the local fixture."
          name="secret"
          defaultValue="fixture-only-value"
          required
          messages={{
            showPassword: "Show fixture credential",
            hidePassword: "Hide fixture credential",
          }}
        />
        <RadioGroup
          label="Fixture approval"
          name="approval"
          defaultValue="review"
          required
          options={[
            {
              value: "disabled",
              label: "Unavailable approval",
              disabled: true,
              disabledReason: "Permission required",
            },
            {
              value: "review",
              label: "Review first",
              description: "An owner reviews the prepared operation before it can run.",
            },
            {
              value: "manual",
              label: "Manual approval",
              description: "The owner starts each operation after reviewing the retained draft.",
            },
          ]}
        />
        <Button type="submit">Save fixture fields</Button>
        <Button type="reset">Reset fixture fields</Button>
      </form>
      <output aria-label="Saved fixture fields">{saved}</output>
      <Button
        ref={menu}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Open fixture actions
      </Button>
      {open ? (
        <DropdownMenu
          anchor={menu}
          returnFocusRef={menu}
          label="Fixture actions"
          onClose={() => setOpen(false)}
          onPick={setPicked}
          items={[
            { kind: "item", id: "copy", label: "Copy fixture" },
            { kind: "item", id: "locked", label: "Locked action", disabled: true },
            { kind: "sep" },
            {
              kind: "item",
              id: "retry",
              label: "Retry fixture",
              description: "Retry using the retained draft",
            },
          ]}
        />
      ) : null}
      <output aria-label="Picked fixture action">{picked}</output>
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
  const [revealed, setRevealed] = useState("");
  const [selected, setSelected] = useState<string[]>(["missing"]);
  const options = [
    { value: "one", label: "First" },
    { value: "two", label: "Second" },
  ];
  return (
    <main className="h-full overflow-auto p-6 text-content">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-medium">bycoda controls</h1>
        <div className="my-4 flex flex-wrap gap-2">
          <Button onClick={() => applyAccentColor(themePalette.hex3b82f6)}>Saturated accent</Button>
          <Button onClick={() => applyAccentColor(null)}>Reset accent</Button>
        </div>
        <section aria-label="AI question fixture">
          <QuestionForm
            prompt={{
              requestId: 404,
              questions: [
                {
                  id: "stops",
                  prompt: "Başka pencereye tıklayınca duran şey hangisi?",
                  multiSelect: false,
                  allowCustom: true,
                  options: [
                    {
                      id: "animation",
                      label: "Arka plan animasyonu ve çalışma göstergesi",
                      description: "Mesaj akışı devam ediyor; yalnızca görsel hareket duruyor.",
                    },
                    { id: "messages", label: "Mesaj akışı / ajanın yaptığı iş" },
                    { id: "app", label: "Uygulamanın tamamı; geri dönünce de tepki vermiyor" },
                  ],
                },
              ],
            }}
            onReply={() => {}}
          />
        </section>
        <ControlSpecimen expanded />
        <NativeSelectionFormFixture />
        <FeedbackFixture />
        <FieldFamiliesFixture />
        <AsyncActionGroupFixture />
        <section aria-label="Navigation search" className="my-4 grid gap-2">
          <SettingsSearch
            onReveal={(section, setting) => setRevealed(`${section}:${setting ?? ""}`)}
          />
          <output aria-label="Revealed setting">{revealed}</output>
        </section>
        <section aria-label="Metadata selection" className="my-4 grid gap-2">
          <SearchableSelect
            multiple
            label="Metadata selection"
            value={selected}
            onChange={setSelected}
            showSelectedValues
            options={[
              { value: "ready", label: "Ready", description: "Available for selection" },
              {
                value: "locked",
                label: "Locked",
                description: "Permission required",
                disabled: true,
              },
            ]}
          />
          <output aria-label="Selected metadata values">{selected.join(",")}</output>
        </section>
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
        <Button motion="none" iconOnly label="Native keyboard hint" shortcut="Ctrl+Shift+K">
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
        <Button
          variant="ghost"
          iconOnly
          label="Refresh quiet action"
          loading={busy}
          disabled={busy}
          onClick={() => setCount((value) => value + 1)}
        >
          <Search aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          motion="none"
          loading={busy}
          disabled={busy}
          onClick={() => setCount((value) => value + 1)}
        >
          Quiet native action
        </Button>
      </div>
      <output aria-label="Button action count">{count}</output>
    </section>
  );
}

function AdditionalControls() {
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
