import { Button, type ButtonTone } from "./Button";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";
import { useT } from "../i18n";
import { useRef, useState, type ReactNode } from "react";
import { Select } from "./Select";
import { OverflowTooltip } from "./Tooltip";
import { MiddleTruncate } from "./MiddleTruncate";
import { Switch } from "./Switch";
import { Slider } from "./Slider";
import { SegmentedControl } from "./SegmentedControl";
import { Popover } from "./Popover";
import { BadgeSpecimen } from "./BadgeSpecimen";
import { Alert } from "./Alert";
import { Progress } from "./Progress";
import { Skeleton } from "./Skeleton";
import { NumberField } from "./NumberField";
import { PasswordField } from "./PasswordField";
import { RadioGroup } from "./RadioGroup";
import { TagInput } from "./TagInput";
import { Checkbox } from "./Checkbox";
import { ActionHost, InlineAction, InlineTextAction } from "./ActionHost";
import { EmptyState } from "./EmptyState";
import { FailureState } from "./FailureState";
import { ExpandingSearch } from "./ExpandingSearch";
import { FilterTrigger } from "./FilterTrigger";
import { Spinner } from "./Spinner";
import { Stepper } from "./Stepper";
import { Bold, Check, ChevronRight, ListFilter, Minus, Plus, X } from "./icons";
import { themePalette } from "../theme/palette";
import { ColorPickerPopover } from "./ColorPickerPopover";
import { ActivityHeatmap, BarChart, DonutChart } from "./Charts";
import { DateTimePicker } from "./DateTimePicker";
import { ImageAnnotationToolbar } from "./ImageAnnotationCanvas";
import { InlineEdit } from "./InlineEdit";
import { JsonViewer } from "./JsonViewer";
import { MediaToolbar, MediaToolbarButton } from "./MediaToolbar";
import { SearchableSelect } from "./SearchableSelect";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { SortableDataTable } from "./SortableDataTable";
import { CollectionSpecimen } from "./CollectionSpecimen";
import { Timeline } from "./Timeline";
import { ControlBehaviorMatrix, type ControlMatrixLayout } from "./ControlBehaviorMatrix";
import { UsageMeter } from "./UsageMeter";
import { TreeRow, TreeRowIcon, TreeRowLabel, TreeRowToggle, TreeRowTrailing } from "./TreeRow";
import { DisclosureSpecimen } from "./DisclosureSpecimen";

const LONG = "A deliberately long value that must truncate or wrap without breaking the layout";

function Family({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section aria-label={name} className="grid min-w-0 gap-1.5" data-specimen-family={name}>
      <h3 className="text-ui-caption font-medium text-(--ui-text-secondary)">{name}</h3>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] items-start gap-2">
        {children}
      </div>
    </section>
  );
}

function Cell({
  state,
  narrow = false,
  children,
}: {
  state: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-specimen-state={state}
      className={`grid min-w-0 gap-1 ${narrow ? "max-w-[7.5rem]" : ""}`}
    >
      <span className="text-ui-micro text-(--ui-text-secondary)">{state}</span>
      {children}
    </div>
  );
}

function StateMatrix({ layout }: { layout: ControlMatrixLayout }) {
  const t = useT();
  const [value, setValue] = useState("compact");
  const [tags, setTags] = useState<string[]>(["alpha"]);
  const [tool, setTool] = useState<"box" | "arrow" | "pen" | "pin">("box");
  const [color, setColor] = useState<string>(themePalette.hexA3ACB8);
  const [when, setWhen] = useState("2026-10-28T09:30");
  const [picked, setPicked] = useState("compact");
  const [many, setMany] = useState<string[]>(["compact"]);
  const [title, setTitle] = useState(t("Control preview"));
  const choices = [
    { value: "compact", label: t("Compact") },
    { value: "long", label: LONG },
  ];
  const noop = () => undefined;
  return (
    <div className="grid min-w-0 gap-4" aria-label={t("State matrix")} role="group">
      <Family name="Button">
        <Cell state="normal / hover / pressed / focus">
          <Button variant="primary">{t("Save")}</Button>
        </Cell>
        <Cell state="selected">
          <Button selected aria-pressed="true">
            {t("Selected")}
          </Button>
        </Cell>
        <Cell state="disabled">
          <Button disabled>{t("Unavailable")}</Button>
        </Cell>
        <Cell state="loading">
          <Button loading loadingLabel={t("Saving…")}>
            {t("Save")}
          </Button>
        </Cell>
        <Cell state="long">
          <Button>{LONG}</Button>
        </Cell>
        <Cell state="narrow" narrow>
          <Button>{t("Save changes")}</Button>
        </Cell>
      </Family>

      <Family name="Icon / toolbar button">
        <Cell state="normal / hover / pressed / focus">
          <Button variant="ghost" iconOnly label={t("Add")}>
            <Plus className="icon-sm" />
          </Button>
        </Cell>
        <Cell state="pressed (toggle)">
          <Button variant="ghost" iconOnly label={t("Bold")} pressed>
            <Minus className="icon-sm" />
          </Button>
        </Cell>
        <Cell state="disabled">
          <Button variant="ghost" iconOnly label={t("Close")} disabled>
            <X className="icon-sm" />
          </Button>
        </Cell>
        <Cell state="loading">
          <Button variant="ghost" iconOnly label={t("Loading…")} loading>
            <Plus className="icon-sm" />
          </Button>
        </Cell>
      </Family>

      <Family name="Text field">
        <Cell state="normal / hover / focus">
          <TextField label={t("Name")} defaultValue={t("Control preview")} />
        </Cell>
        <Cell state="error">
          <TextField label={t("Name")} defaultValue="" error={t("Required")} />
        </Cell>
        <Cell state="disabled">
          <TextField label={t("Name")} defaultValue={t("Unavailable")} disabled />
        </Cell>
        <Cell state="readOnly">
          <TextField label={t("Name")} defaultValue={t("Selected")} readOnly />
        </Cell>
        <Cell state="long">
          <TextField label={t("Name")} defaultValue={LONG} description={LONG} />
        </Cell>
        <Cell state="narrow / compact" narrow>
          <TextField label={t("Name")} fieldVariant="compact" defaultValue={LONG} />
        </Cell>
      </Family>

      <Family name="Textarea">
        <Cell state="normal">
          <TextareaField label={t("Description")} rows={2} />
        </Cell>
        <Cell state="error">
          <TextareaField label={t("Description")} rows={2} error={t("Required")} />
        </Cell>
        <Cell state="disabled">
          <TextareaField label={t("Description")} rows={2} disabled defaultValue={LONG} />
        </Cell>
        <Cell state="compact">
          <TextareaField label={t("Description")} fieldVariant="compact" defaultValue={LONG} />
        </Cell>
      </Family>

      <Family name="Number / password">
        <Cell state="number normal">
          <NumberField label={t("Preview")} defaultValue={50} min={0} max={100} />
        </Cell>
        <Cell state="number at max">
          <NumberField label={t("Preview")} defaultValue={100} min={0} max={100} />
        </Cell>
        <Cell state="number readOnly">
          <NumberField label={t("Preview")} defaultValue={50} readOnly />
        </Cell>
        <Cell state="number error">
          <NumberField label={t("Preview")} defaultValue={500} error={t("Required")} />
        </Cell>
        <Cell state="password normal">
          <PasswordField label={t("Password")} defaultValue="preview" autoComplete="off" />
        </Cell>
        <Cell state="password disabled">
          <PasswordField label={t("Password")} defaultValue="preview" disabled />
        </Cell>
      </Family>

      <Family name="Tooltip visibility">
        <Cell state="readable label, no repeated hint">
          <Button tooltip={t("Preview")} tooltipWhen="overflow">
            {t("Preview")}
          </Button>
        </Cell>
        <Cell state="full text on actual clipping" narrow>
          <OverflowTooltip label={LONG}>
            <span className="min-w-0 truncate">{LONG}</span>
          </OverflowTooltip>
        </Cell>
        <Cell state="middle truncation, no native title" narrow>
          <MiddleTruncate>{LONG}</MiddleTruncate>
        </Cell>
        <Cell state="extra details remain available">
          <Button tooltipDetails={[t("Required")]}>{t("Preview")}</Button>
        </Cell>
      </Family>

      <Family name="Select (field composition)">
        <Cell state="normal">
          <Select label={t("Preview")} value={value} options={choices} onValueChange={setValue} />
        </Cell>
        <Cell state="help + error">
          <Select
            label={t("Preview")}
            value={value}
            options={choices}
            onValueChange={setValue}
            description={t("Preview")}
            error={t("Required")}
          />
        </Cell>
        <Cell state="disabled">
          <Select
            label={t("Preview")}
            value={value}
            options={choices}
            onValueChange={setValue}
            disabled
          />
        </Cell>
        <Cell state="long option, compact">
          <Select
            label={t("Preview")}
            fieldVariant="compact"
            value="long"
            options={choices}
            onValueChange={setValue}
          />
        </Cell>
      </Family>

      <Family name="Segmented / radio / checkbox / switch">
        <Cell state="segmented">
          <SegmentedControl
            label={t("Layout")}
            value={value}
            options={choices}
            onValueChange={setValue}
          />
        </Cell>
        <Cell state="radio selected / disabled">
          <RadioGroup
            label={t("Preview")}
            defaultValue="selected"
            compact
            options={[
              { value: "selected", label: t("Selected") },
              { value: "unavailable", label: t("Unavailable"), disabled: true },
            ]}
          />
        </Cell>
        <Cell state="checkbox checked / error / disabled">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Checkbox defaultChecked aria-label={t("Selected")} />
            <Checkbox aria-invalid aria-label={t("Required")} />
            <Checkbox disabled aria-label={t("Unavailable")} />
          </div>
        </Cell>
        <Cell state="switch off / on / disabled">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Switch label={t("Enabled")} checked={false} onCheckedChange={noop} />
            <Switch label={t("Selected")} checked onCheckedChange={noop} />
            <Switch label={t("Unavailable")} checked={false} disabled onCheckedChange={noop} />
          </div>
        </Cell>
      </Family>

      <Family name="Tags / filter">
        <Cell state="tags">
          <TagInput
            label={t("Tags")}
            value={[...tags, LONG]}
            onValueChange={setTags}
            removeLabel={(tag) => t("Remove #{p0}", { p0: tag })}
          />
        </Cell>
        <Cell state="filter idle / active">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <FilterTrigger label={t("Filter")} activeCount={0} />
            <FilterTrigger
              label={t("Filter")}
              activeCount={2}
              onReset={noop}
              resetLabel={t("Reset filters")}
            />
          </div>
        </Cell>
      </Family>

      <Family name="Row / tree / inline action">
        <Cell state="row selected">
          <ActionHost selected className="h-7 px-2">
            <span className="text-ui-secondary min-w-0 flex-1 truncate">{LONG}</span>
            <InlineAction reveal="always" label={t("Close")}>
              <X className="icon-sm" />
            </InlineAction>
          </ActionHost>
        </Cell>
        <Cell state="tree normal / selected / drop / disabled">
          <div role="tree" className="grid min-w-0">
            <TreeRow depth={0} aria-expanded>
              <TreeRowToggle>
                <ChevronRight />
              </TreeRowToggle>
              <TreeRowLabel>{t("Preview")}</TreeRowLabel>
              <TreeRowTrailing>3</TreeRowTrailing>
            </TreeRow>
            <TreeRow depth={1} selected>
              <TreeRowToggle />
              <TreeRowIcon />
              <TreeRowLabel>{LONG}</TreeRowLabel>
            </TreeRow>
            <TreeRow depth={1} dropTarget>
              <TreeRowToggle />
              <TreeRowLabel>{t("Selected")}</TreeRowLabel>
            </TreeRow>
            <TreeRow depth={1} disabled>
              <TreeRowToggle />
              <TreeRowLabel>{t("Unavailable")}</TreeRowLabel>
            </TreeRow>
          </div>
        </Cell>
      </Family>

      <Family name="Status and feedback">
        <Cell state="badges">
          <BadgeSpecimen />
        </Cell>
        <Cell state="alert">
          <Alert tone="danger">{LONG}</Alert>
        </Cell>
        <Cell state="progress determinate / indeterminate">
          <div className="grid gap-2">
            <Progress label={t("Progress")} value={40} />
            <Progress label={t("Progress")} />
          </div>
        </Cell>
        <Cell state="loading">
          <div className="grid gap-2">
            <Spinner label={t("Loading…")} />
            <Skeleton lines={2} label={t("Loading…")} />
          </div>
        </Cell>
        <Cell state="empty / filtered / unavailable+retry">
          <div className="grid gap-2">
            <EmptyState
              context="panel"
              kind="empty"
              title={t("Preview")}
              description={t("Nothing here yet.")}
            />
            <EmptyState
              context="panel"
              kind="filtered"
              title={t("Preview")}
              description={t("No results match the filters.")}
            />
            <FailureState
              context="panel"
              title={t("Preview")}
              description={t("Could not load.")}
              onRetry={noop}
            />
          </div>
        </Cell>
      </Family>

      <Family name="Date, time and colour">
        <Cell state="date-time normal">
          <DateTimePicker label={t("Date and time")} value={when} onChange={setWhen} />
        </Cell>
        <Cell state="date-time disabled">
          <DateTimePicker label={t("Date and time")} value={when} onChange={setWhen} disabled />
        </Cell>
        <Cell state="date-time readOnly / invalid">
          <DateTimePicker
            label={t("Date and time")}
            value={when}
            onChange={setWhen}
            readOnly
            error={t("Choose a valid date and time.")}
          />
        </Cell>
        <Cell state="colour normal">
          <ColorPickerPopover value={color} onChange={setColor} />
        </Cell>
        <Cell state="colour disabled">
          <ColorPickerPopover value={color} onChange={setColor} disabled />
        </Cell>
        <Cell state="colour readOnly">
          <ColorPickerPopover value={color} onChange={setColor} readOnly />
        </Cell>
      </Family>

      <Family name="Charts">
        <Cell state="donut (patterns + legend)">
          <DonutChart
            label={t("Preview")}
            size={140}
            data={[
              { key: "a", label: t("Preview"), value: 40 },
              { key: "b", label: t("Selected"), value: 30 },
              { key: "c", label: t("Details"), value: 20 },
              { key: "d", label: LONG, value: 10 },
            ]}
          />
        </Cell>
        <Cell state="bars (single series)">
          <BarChart
            label={t("Preview")}
            period="2026"
            height={120}
            data={[4, 7, 3, 9, 6].map((value, index) => ({
              key: `day-${index}`,
              label: `#${index + 1}`,
              axisLabel: `${index + 1}`,
              value,
            }))}
          />
        </Cell>
        <Cell state="bars (grouped series + legend)">
          <BarChart
            label={t("Preview")}
            period="2026"
            height={120}
            seriesLabels={[t("Preview"), t("Selected"), LONG]}
            data={[
              [4, 2, 1],
              [7, 5, 3],
              [3, 6, 2],
              [9, 4, 5],
            ].map((values, index) => ({
              key: `group-${index}`,
              label: `#${index + 1}`,
              axisLabel: `${index + 1}`,
              value: values.reduce((sum, value) => sum + value, 0),
              values,
            }))}
          />
        </Cell>
        <Cell state="heatmap (level markers)">
          <ActivityHeatmap
            label={t("Preview")}
            period="2026"
            days={Array.from({ length: 70 }, (_, index) => ({
              date: new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10),
              count: (index * 7) % 13,
            }))}
          />
        </Cell>
      </Family>

      <Family name="Media toolbar / annotation">
        <Cell state="overlay toolbar">
          <MediaToolbar label={t("Zoom")}>
            <MediaToolbarButton label={t("Zoom out")}>
              <Minus className="icon-sm" />
            </MediaToolbarButton>
            <MediaToolbarButton label={t("Zoom in")}>
              <Plus className="icon-sm" />
            </MediaToolbarButton>
            <MediaToolbarButton label={t("Reset zoom")} disabled>
              <X className="icon-sm" />
            </MediaToolbarButton>
          </MediaToolbar>
        </Cell>
        <Cell state="annotation tools (surface)">
          <ImageAnnotationToolbar
            tool={tool}
            onToolChange={setTool}
            onUndo={noop}
            onClear={noop}
            canUndo
          />
        </Cell>
        <Cell state="annotation tools disabled">
          <ImageAnnotationToolbar tool={tool} onToolChange={setTool} onUndo={noop} disabled />
        </Cell>
      </Family>

      <Family name="Searchable select / search">
        <Cell state="normal (field composition)">
          <SearchableSelect
            label={t("Preview")}
            options={choices}
            value={picked}
            onChange={setPicked}
          />
        </Cell>
        <Cell state="help + error">
          <SearchableSelect
            hideLabel
            label={t("Preview")}
            options={choices}
            value={picked}
            onChange={setPicked}
            description={t("Preview")}
            fieldError={t("Required")}
          />
        </Cell>
        <Cell state="multiple / side flyout">
          <SearchableSelect
            side="right"
            label={t("Preview")}
            multiple
            options={choices}
            value={many}
            onChange={setMany}
            showSelectedValues
          />
        </Cell>
        <Cell state="loading">
          <SearchableSelect
            label={t("Preview")}
            options={choices}
            value={picked}
            onChange={setPicked}
            loading
          />
        </Cell>
        <Cell state="load failed + retry">
          <SearchableSelect
            label={t("Preview")}
            options={choices}
            value={picked}
            onChange={setPicked}
            error={t("Could not load.")}
            onRetry={noop}
          />
        </Cell>
        <Cell state="disabled">
          <SearchableSelect
            label={t("Preview")}
            options={choices}
            value={picked}
            onChange={setPicked}
            disabled
          />
        </Cell>
        <Cell state="expanding search (ghost)">
          <ExpandingSearch label={t("Search")} items={[]} expandedWidth={240} />
        </Cell>
      </Family>

      <Family name="Slider / inline edit">
        <Cell state="normal">
          <Slider label={t("Preview")} defaultValue={40} min={0} max={100} showValue />
        </Cell>
        <Cell state="range">
          <Slider label={t("Preview")} defaultValue={[20, 70]} min={0} max={100} showValue />
        </Cell>
        <Cell state="inline edit">
          <InlineEdit label={t("Name")} value={title} onSave={(next) => setTitle(next)} />
        </Cell>
        <Cell state="inline edit long">
          <InlineEdit label={t("Name")} value={LONG} onSave={noop} />
        </Cell>
      </Family>

      <Family name="JSON viewer">
        <Cell state="expanded / search / copy">
          <JsonViewer
            label={t("Preview")}
            data={{
              name: "preview",
              enabled: true,
              items: [1, 2, 3],
              nested: { long: LONG },
            }}
            defaultExpandDepth={2}
            searchable
            maxHeight={200}
          />
        </Cell>
        <Cell state="paged">
          <JsonViewer
            label={t("Preview")}
            data={Array.from({ length: 30 }, (_, index) => ({
              index,
              status: "ready",
            }))}
            pageSize={5}
            maxHeight={160}
          />
        </Cell>
      </Family>

      <Family name="Shortcut recorder">
        <Cell state="bound">
          <ShortcutRecorder label={t("Preview")} defaultValue="mod+k" />
        </Cell>
        <Cell state="empty">
          <ShortcutRecorder label={t("Preview")} defaultValue={null} />
        </Cell>
        <Cell state="disabled">
          <ShortcutRecorder label={t("Preview")} defaultValue="mod+k" disabled />
        </Cell>
        <Cell state="help text">
          <ShortcutRecorder label={t("Preview")} defaultValue="mod+k" description={LONG} />
        </Cell>
      </Family>

      <Family name="Stepper">
        <Cell state="horizontal">
          <Stepper
            label={t("Preview")}
            current={1}
            steps={[
              { id: "a", label: t("Preview"), description: t("Selected") },
              { id: "b", label: t("Selected") },
              { id: "c", label: LONG },
            ]}
          />
        </Cell>
        <Cell state="vertical + error + disabled">
          <Stepper
            label={t("Preview")}
            orientation="vertical"
            current={1}
            steps={[
              { id: "a", label: t("Preview") },
              { id: "b", label: t("Selected"), error: t("Required") },
              { id: "c", label: t("Unavailable"), disabled: true },
            ]}
          />
        </Cell>
        <Cell state="compact / narrow" narrow>
          <Stepper
            compact
            label={t("Preview")}
            current={1}
            steps={[
              { id: "a", label: t("Preview") },
              { id: "b", label: t("Selected") },
              { id: "c", label: t("Details") },
            ]}
          />
        </Cell>
      </Family>

      <Family name="Timeline">
        <Cell state="neutral / success / danger + detail">
          <Timeline
            label={t("Preview")}
            now={1_800_000_000_000}
            events={[
              {
                id: "a",
                at: 1_799_999_900_000,
                title: t("Preview"),
                tone: "success",
              },
              {
                id: "b",
                at: 1_799_999_800_000,
                title: LONG,
                tone: "danger",
                detail: LONG,
              },
              {
                id: "c",
                at: 1_799_999_700_000,
                title: t("Selected"),
                meta: t("Details"),
              },
            ]}
          />
        </Cell>
      </Family>

      <Family name="Usage meter / data table">
        <Cell state="normal">
          <UsageMeter
            label={t("Preview")}
            segments={[{ id: "used", label: t("Selected"), value: 40 }]}
            limit={100}
            unit="%"
            decimals={0}
          />
        </Cell>
        <Cell state="near limit">
          <UsageMeter
            label={t("Preview")}
            segments={[{ id: "used", label: t("Selected"), value: 92 }]}
            limit={100}
            unit="%"
            decimals={0}
          />
        </Cell>
        <Cell state="over limit, multi segment">
          <UsageMeter
            label={t("Preview")}
            segments={[
              { id: "a", label: t("Selected"), value: 80 },
              { id: "b", label: t("Details"), value: 40 },
            ]}
            limit={100}
            unit="%"
            decimals={0}
          />
        </Cell>
        <Cell state="sortable table">
          <SortableDataTable
            caption={t("Preview")}
            rowKey="id"
            rows={[
              { id: "a", name: t("Preview"), cost: 10 },
              { id: "b", name: LONG, cost: 2 },
            ]}
            columns={[
              { key: "name", label: t("Name"), sortable: true },
              { key: "cost", label: t("Value"), sortable: true, numeric: true },
            ]}
          />
        </Cell>
      </Family>
      <ControlBehaviorMatrix initialLayout={layout} />
      <CollectionSpecimen />
    </div>
  );
}

/**
 * The single local-only control reference (see tests/browser/shared-ui/arc-controls.tsx): live samples, an
 * optional wider family set (`expanded`) and the per-family state matrix (`matrix`). No production
 * route imports it, and it must not be added to normal settings. Add new families and states here,
 * not in a second specimen list.
 */
export function ControlSpecimen({
  expanded = false,
  matrix = false,
  matrixLayout = "default",
}: {
  expanded?: boolean;
  /**
   * Adds the per-family state matrix (normal, selected, disabled, loading, error, long, narrow)
   * below the samples. `"only"` renders just the matrix for a focused state review.
   */
  matrix?: boolean | "only";
  /** Initial container stress of the behaviour matrix: `default`, `narrow` or `short` pane. */
  matrixLayout?: ControlMatrixLayout;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const [value, setValue] = useState("compact");
  const [amount, setAmount] = useState(50);
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [bold, setBold] = useState(false);
  const [filters, setFilters] = useState(2);
  const anchor = useRef<HTMLButtonElement>(null);
  const choices = [
    { value: "compact", label: t("Compact") },
    { value: "comfortable", label: t("Comfortable") },
  ];
  const tones: ButtonTone[] = ["neutral", "accent", "info", "success", "warning", "danger"];
  if (matrix === "only") {
    return (
      <section aria-label={t("Control preview")} className="grid min-w-0 gap-3">
        <StateMatrix layout={matrixLayout} />
      </section>
    );
  }
  return (
    <section aria-label={t("Control preview")} className="grid min-w-0 gap-3">
      {expanded ? (
        (["primary", "secondary", "ghost", "link"] as const).map((variant) => (
          <div key={variant} className="flex min-w-0 flex-wrap items-center gap-2">
            {tones.map((tone) => (
              <Button key={tone} variant={variant} tone={tone} motion="none">
                {variant} / {tone}
              </Button>
            ))}
          </div>
        ))
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="primary">{t("Save")}</Button>
          <Button>{t("Cancel")}</Button>
          <Button variant="ghost" tone="danger">
            {t("Delete")}
          </Button>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button selected aria-pressed="true">
          {t("Selected")}
        </Button>
        <Button disabled>{t("Unavailable")}</Button>
        <Button loading loadingLabel={t("Saving…")}>
          {t("Save")}
        </Button>
      </div>
      <TextField label={t("Name")} defaultValue={t("Control preview")} />
      <TextareaField label={t("Description")} rows={2} />
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Select
          hideLabel
          label={t("Preview")}
          value={value}
          options={choices}
          onValueChange={setValue}
        />
        <Switch label={t("Enabled")} checked={enabled} onCheckedChange={setEnabled} />
        <Button
          ref={anchor}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t("Details")}
        </Button>
      </div>
      <SegmentedControl
        label={t("Layout")}
        value={value}
        options={choices}
        onValueChange={setValue}
      />
      <Slider label={t("Preview")} value={amount} onValueChange={setAmount} min={0} max={100} />
      {expanded ? <TextField label={t("Required")} error={t("Required")} required /> : null}
      {expanded ? (
        <div className="grid min-w-0 gap-3">
          <SearchableSelect
            hideLabel
            label={t("Layout")}
            options={choices}
            value={value}
            onChange={setValue}
          />
          <NumberField label={t("Preview")} defaultValue={50} min={0} max={100} />
          <PasswordField label={t("Password")} defaultValue="preview" autoComplete="off" />
          <RadioGroup
            label={t("Preview")}
            defaultValue="selected"
            compact
            options={[
              { value: "selected", label: t("Selected") },
              { value: "unavailable", label: t("Unavailable"), disabled: true },
            ]}
          />
          <TagInput
            label={t("Tags")}
            placeholder={t("Add tag…")}
            value={tags}
            onValueChange={setTags}
            removeLabel={(tag) => t("Remove #{p0}", { p0: tag })}
          />
          <label className="flex items-center gap-2">
            <Checkbox defaultChecked />
            {t("Preview")}
          </label>
          <BadgeSpecimen label={t("Preview")} labelsOnly />
          <Alert tone="info">{t("Preview")}</Alert>
          <Progress label={t("Progress")} value={amount} />
          <Skeleton lines={2} label={t("Loading…")} />
          {/* One toolbar family: 28px ghost icon controls, 4px gaps, the closed search identical to its neighbours. */}
          <div className="flex min-w-0 items-center gap-1">
            <ExpandingSearch label={t("Search")} items={[]} expandedWidth={240} />
            <FilterTrigger label={t("Filter")} activeCount={0} />
            <FilterTrigger
              label={t("Filter")}
              activeCount={filters}
              onReset={() => setFilters(0)}
              resetLabel={t("Reset filters")}
            />
            <Button
              variant="ghost"
              iconOnly
              label={t("Bold")}
              pressed={bold}
              onClick={() => setBold(!bold)}
            >
              <Bold className="icon-sm" />
            </Button>
            <Button variant="ghost" iconOnly label={t("Filter")} disabled>
              <ListFilter className="icon-sm" />
            </Button>
          </div>
          {/* A row owns the highlight; icon and text inline actions share its hover and selected fill. */}
          <ActionHost selected className="h-7 px-2">
            <span className="text-ui-secondary min-w-0 flex-1 truncate">{t("Preview")}</span>
            <InlineTextAction onClick={() => undefined}>{t("Undo")}</InlineTextAction>
            <InlineAction reveal="always" label={t("Close")}>
              <X className="icon-sm" />
            </InlineAction>
          </ActionHost>
          <div className="flex min-w-0 items-center gap-3">
            <Spinner size="xs" />
            <Spinner />
            <Spinner size="md" label={t("Loading…")} />
            <Check className="icon-sm" aria-hidden />
          </div>
          <Stepper
            label={t("Progress")}
            steps={[
              { id: "a", label: t("Preview") },
              { id: "b", label: t("Selected") },
              { id: "c", label: t("Details") },
              { id: "d", label: t("Required") },
              { id: "e", label: t("Close") },
            ]}
            current={1}
          />
          <FailureState
            context="panel"
            title={t("Preview")}
            description={t("Unavailable")}
            onRetry={() => undefined}
          />
        </div>
      ) : null}
      {expanded ? <DisclosureSpecimen /> : null}
      {matrix ? <StateMatrix layout={matrixLayout} /> : null}
      {open ? (
        <Popover
          anchor={anchor}
          role="dialog"
          aria-label={t("Control preview")}
          onDismiss={() => {
            setOpen(false);
            anchor.current?.focus({ preventScroll: true });
          }}
        >
          <div className="grid gap-2 p-3">
            <span>{t("Preview")}</span>
            <Button
              onClick={() => {
                setOpen(false);
                anchor.current?.focus({ preventScroll: true });
              }}
            >
              {t("Close")}
            </Button>
          </div>
        </Popover>
      ) : null}
    </section>
  );
}
