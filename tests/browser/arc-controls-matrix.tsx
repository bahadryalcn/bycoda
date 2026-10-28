// Fixture-only real-control state matrix (CMP-07 / UIF-20). It lives under tests/browser so its strings stay
// plain English and out of the product locale catalogs. FIXTURE evidence only: current public adapters with
// memory-only state, never installed/native acceptance.
import { useMemo, useState, type ReactNode } from "react";
import { ActionHost, InlineAction } from "../../src/shared/ui/ActionHost";
import { Button } from "../../src/shared/ui/Button";
import { ButtonGroup } from "../../src/shared/ui/ButtonGroup";
import { SplitButton } from "../../src/shared/ui/SplitButton";
import { ExpandingButtonGroup } from "../../src/shared/ui/ExpandingButtonGroup";
import { TextField } from "../../src/shared/ui/TextField";
import { TextareaField } from "../../src/shared/ui/TextareaField";
import { Select } from "../../src/shared/ui/Select";
import { Switch } from "../../src/shared/ui/Switch";
import { SegmentedControl } from "../../src/shared/ui/SegmentedControl";
import { NumberField } from "../../src/shared/ui/NumberField";
import { DateRangePicker } from "../../src/shared/ui/DateRangePicker";
import { PasswordField } from "../../src/shared/ui/PasswordField";
import { RadioGroup } from "../../src/shared/ui/RadioGroup";
import { TagInput } from "../../src/shared/ui/TagInput";
import { NativeSearchableSelect } from "../../src/shared/ui/NativeSearchableSelect";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { MorphSelect } from "../../src/shared/ui/MorphSelect";
import { SearchInput, SearchInputGroup } from "../../src/shared/ui/SearchInput";
import { InlineEdit } from "../../src/shared/ui/InlineEdit";
import { Checkbox } from "../../src/shared/ui/Checkbox";
import { TabDirtyDot, TabLabel } from "../../src/shared/ui/TabLabel";
import { MiddleTruncate } from "../../src/shared/ui/MiddleTruncate";
import { Stepper } from "../../src/shared/ui/Stepper";
import {
  TreeRow,
  TreeRowIcon,
  TreeRowLabel,
  TreeRowToggle,
  TreeRowTrailing,
} from "../../src/shared/ui/TreeRow";
import { MatchText, matchPositions } from "../../src/shared/ui/MatchText";
import { Timestamp } from "../../src/shared/ui/Timestamp";
import { ShortcutKbd, ShortcutKeys } from "../../src/shared/ui/ShortcutKbd";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FolderOpen,
  GitMerge,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "../../src/shared/ui/icons";

export type ControlMatrixLayout = "default" | "narrow" | "short";

const SIZES = ["sm", "md", "lg"] as const;
const VARIANTS = ["primary", "secondary", "ghost", "danger", "link"] as const;

function MatrixGroup({
  name,
  testId,
  children,
  className = "flex min-w-0 flex-wrap items-center gap-2",
}: {
  name: string;
  testId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={name}
      data-testid={testId}
      className="grid min-w-0 grid-cols-1 gap-1.5"
    >
      <h3 className="text-[length:var(--ui-font-secondary)] text-[var(--ui-text-secondary)]">
        {name}
      </h3>
      <div className={className}>{children}</div>
    </div>
  );
}

function MatrixSection({
  name,
  testId,
  children,
}: {
  name: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={name} data-testid={testId} className="grid min-w-0 grid-cols-1 gap-4">
      <h2 className="text-lg font-medium">{name}</h2>
      {children}
    </section>
  );
}

function ActionsMatrix() {
  const [count, setCount] = useState(0);
  const [pressed, setPressed] = useState(false);
  const bump = () => setCount((value) => value + 1);
  const names: Record<string, string> = {
    primary: "Primary",
    secondary: "Secondary",
    ghost: "Ghost",
    danger: "Danger",
    link: "Link",
    neutral: "Neutral",
    accent: "Accent",
    info: "Info",
    success: "Success",
    warning: "Warning",
  };
  const label = (name: string) => names[name] ?? name;
  const longLabel = "A deliberately long action label that must wrap or truncate without overflow";
  return (
    <MatrixSection name={"Actions"} testId="matrix-actions">
      <MatrixGroup
        name={"Variants by size"}
        testId="matrix-action-variants"
        className="grid min-w-0 grid-cols-1 gap-2"
      >
        {VARIANTS.map((variant) => (
          <div key={variant} className="flex min-w-0 flex-wrap items-center gap-2">
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {label(variant)} {size}
              </Button>
            ))}
          </div>
        ))}
      </MatrixGroup>
      <MatrixGroup name={"Icon only by size"} testId="matrix-action-icons">
        {(["secondary", "ghost"] as const).map((variant) =>
          SIZES.map((size) => (
            <Button
              key={`${variant}-${size}`}
              variant={variant}
              size={size}
              iconOnly
              label={`${label(variant)} ${size} ${"icon"}`}
              tooltip={`${label(variant)} ${size} ${"icon"}`}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
          )),
        )}
      </MatrixGroup>
      <MatrixGroup name={"Tones"} testId="matrix-action-tones">
        {(["neutral", "accent", "info", "success", "warning", "danger"] as const).map((tone) => (
          <Button key={tone} tone={tone}>
            {label(tone)}
          </Button>
        ))}
      </MatrixGroup>
      <MatrixGroup name="States" testId="matrix-action-states">
        <Button onClick={bump}>{"Count action"}</Button>
        <Button loading loadingLabel={"Saving…"} data-testid="matrix-loading-text" onClick={bump}>
          {"Loading action"}
        </Button>
        <Button
          loading
          iconOnly
          variant="ghost"
          label={"Loading icon action"}
          data-testid="matrix-loading-icon"
          onClick={bump}
        >
          <Search className="size-3.5" aria-hidden />
        </Button>
        <Button disabled onClick={bump}>
          {"Disabled action"}
        </Button>
        <Button disabled iconOnly variant="ghost" label={"Disabled icon action"}>
          <Plus className="size-3.5" aria-hidden />
        </Button>
        <Button
          selected={pressed}
          aria-pressed={pressed}
          onClick={() => setPressed((value) => !value)}
        >
          {"Selected action"}
        </Button>
        <Button variant="primary" disabled>
          {"Disabled primary"}
        </Button>
        <output aria-label={"Action count"} data-testid="matrix-action-count">
          {count}
        </output>
      </MatrixGroup>
      <MatrixGroup name={"Long label in a narrow container"} testId="matrix-action-long">
        <div className="grid w-48 min-w-0 max-w-full gap-2" data-testid="matrix-action-narrow">
          <Button fullWidth>{longLabel}</Button>
          <Button fullWidth variant="primary" startIcon={<Plus className="size-3.5" aria-hidden />}>
            {longLabel}
          </Button>
        </div>
      </MatrixGroup>
      <MatrixGroup name={"Joined and split actions"} testId="matrix-action-groups">
        <ButtonGroup aria-label={"Joined actions"}>
          <Button selected aria-pressed>
            {"Day"}
          </Button>
          <Button disabled>Week</Button>
          <Button>{"Month"}</Button>
        </ButtonGroup>
        <SplitButton
          label="Split primary"
          menuLabel={"Split primary options"}
          actions={[
            { id: "one", label: "First option", onSelect: bump },
            { id: "two", label: "Second option", onSelect: bump },
          ]}
          onClick={bump}
        />
        <SplitButton
          label="Split blocked"
          menuLabel={"Split blocked options"}
          disabled
          menuDisabled={false}
          actions={[{ id: "one", label: "Available option", onSelect: bump }]}
        />
        <SplitButton
          label={"Split loading"}
          menuLabel={"Split loading options"}
          loading
          actions={[{ id: "one", label: "Unavailable option", onSelect: bump }]}
        />
        <ExpandingButtonGroup
          label={"Expanding actions"}
          items={[
            { id: "copy", label: "Copy item", icon: <Copy />, onSelect: bump },
            { id: "add", label: "Add item", icon: <Plus />, onSelect: bump },
          ]}
        />
      </MatrixGroup>
      <MatrixGroup
        name={"Joined seams and split variants"}
        testId="matrix-action-seams"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <ButtonGroup aria-label="Review">
            <Button variant="ghost" startIcon={<Check className="size-3.5" aria-hidden />}>
              {"Approve"}
            </Button>
            <Button variant="ghost" disabled>
              {"Request changes"}
            </Button>
            <Button variant="ghost" selected aria-pressed>
              {"Comment"}
            </Button>
            <Button variant="ghost" loading loadingLabel={"Merging"}>
              {"Merge"}
            </Button>
          </ButtonGroup>
          <ButtonGroup aria-label={"Secondary joined"}>
            <Button variant="secondary">{"One"}</Button>
            <Button variant="secondary">Two</Button>
            <Button variant="secondary" iconOnly label={"More joined actions"}>
              <MoreHorizontal className="size-3.5" aria-hidden />
            </Button>
          </ButtonGroup>
          <ButtonGroup aria-label={"Primary joined"}>
            <Button variant="primary">Save</Button>
            <Button variant="primary" iconOnly label={"Save options"}>
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </ButtonGroup>
        </div>
        <div
          className="flex min-w-0 flex-wrap items-center gap-3"
          data-testid="matrix-split-variants"
        >
          <SplitButton
            variant="primary"
            label="Commit"
            menuLabel={"Commit options"}
            actions={[{ id: "one", label: "Commit and push", onSelect: bump }]}
          />
          <SplitButton
            variant="primary"
            label="Commit blocked"
            menuLabel={"Commit blocked options"}
            disabled
            menuDisabled={false}
            actions={[{ id: "one", label: "Amend commit", onSelect: bump }]}
          />
          <SplitButton
            variant="primary"
            label={"Committing"}
            menuLabel={"Committing options"}
            loading
            actions={[{ id: "one", label: "Cancel commit", onSelect: bump }]}
          />
          <SplitButton
            variant="secondary"
            size="md"
            label="Merge pull request"
            menuLabel={"Merge options"}
            menuDisabled
            actions={[{ id: "one", label: "Squash and merge", onSelect: bump }]}
          />
          <SplitButton
            variant="ghost"
            label="Shell"
            menuLabel={"Shell options"}
            actions={[{ id: "one", label: "New shell", onSelect: bump }]}
          />
        </div>
        <div className="w-64 max-w-full" data-testid="matrix-split-full">
          <SplitButton
            variant="primary"
            fullWidth
            label={"Commit everything"}
            menuLabel={"Commit everything options"}
            actions={[{ id: "one", label: "Commit all and push", onSelect: bump }]}
          />
        </div>
        <div className="flex min-w-0">
          <Button
            variant="secondary"
            startIcon={<GitMerge className="size-3.5" aria-hidden />}
            data-testid="matrix-merge-start-icon"
          >
            {"Merge with icon"}
          </Button>
        </div>
      </MatrixGroup>
      <MatrixGroup name={"Tab alignment"} testId="matrix-action-align">
        <div role="tablist" aria-label={"Aligned tabs"} className="grid w-56 max-w-full gap-1">
          <Button
            variant="tab"
            role="tab"
            aria-selected
            tabIndex={0}
            align="start"
            data-testid="matrix-tab-start"
          >
            {"Explorer root"}
          </Button>
          <Button
            variant="tab"
            role="tab"
            aria-selected={false}
            tabIndex={-1}
            data-testid="matrix-tab-default"
          >
            {"Default centered tab"}
          </Button>
          <Button
            variant="tab"
            role="tab"
            aria-selected={false}
            tabIndex={-1}
            align="end"
            data-testid="matrix-tab-end"
          >
            {"End aligned"}
          </Button>
        </div>
      </MatrixGroup>
    </MatrixSection>
  );
}

function FieldsMatrix() {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("Review notes");
  const longValue = "Project with a very long descriptive name that exceeds the field width";
  return (
    <MatrixSection name="Fields" testId="matrix-fields">
      <MatrixGroup
        name="Text fields"
        testId="matrix-field-text"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <TextField label={"Plain field"} defaultValue="Editable value" />
        <TextField
          label="Field with helper"
          description={"Helper text explains the expected value and may wrap onto a second line."}
          placeholder="Placeholder"
        />
        <TextField label="Field with error" error="This value is required" required />
        <TextField label={"Read only field"} readOnly defaultValue="Selectable value" />
        <TextField label="Disabled field" disabled defaultValue={"Unavailable value"} />
        <TextField label="Required field" required />
        <TextField
          label="Clearable field"
          clearable
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <TextField label={"Long value field"} defaultValue={longValue + longValue} />
      </MatrixGroup>
      <MatrixGroup
        name={"Password, number and text area"}
        testId="matrix-field-special"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <PasswordField
          label="Matrix password"
          defaultValue="matrix-only-value"
          autoComplete="off"
          messages={{
            showPassword: "Show matrix password",
            hidePassword: "Hide matrix password",
          }}
        />
        <PasswordField label="Disabled password" disabled defaultValue="matrix-only-value" />
        <NumberField label={"Matrix number"} defaultValue={10} min={0} max={20} step={1} />
        <NumberField
          label="Number with error"
          error={"Enter a value between 0 and 20"}
          defaultValue={40}
        />
        <NumberField label="Number at its maximum" defaultValue={20} min={0} max={20} />
        <NumberField label="Read only number" readOnly defaultValue={5} />
        <NumberField label="Disabled number" disabled defaultValue={5} />
        <NumberField label="Number without steppers" steppers={false} defaultValue={3} />
        <TextareaField label="Matrix text area" rows={2} description="Helper for a text area" />
        <TextareaField label="Text area with error" rows={2} error={"A description is required"} />
        <TextareaField
          label={"Read only text area"}
          rows={2}
          readOnly
          defaultValue="Selectable text"
        />
        <TextareaField label="Disabled text area" rows={2} disabled />
      </MatrixGroup>
      <MatrixGroup
        name="Date range states"
        testId="matrix-field-dates"
        className="flex min-w-0 flex-wrap items-start gap-2"
      >
        <DateRangePicker label="Matrix range" />
        <DateRangePicker label="Disabled range" disabled />
        <DateRangePicker label="Read only range" readOnly />
        <DateRangePicker label="Invalid range" invalid />
      </MatrixGroup>
      <MatrixGroup name={"Inline editing"} testId="matrix-field-inline">
        <InlineEdit label="Matrix title" value={title} onSave={(next) => setTitle(next)} />
      </MatrixGroup>
      <MatrixGroup
        name={"Compact search beside actions"}
        testId="matrix-field-toolbar"
        className="grid min-w-0 grid-cols-1 gap-2"
      >
        {(["sm", "md"] as const).map((size) => (
          <div
            key={size}
            className="flex min-w-0 items-center gap-2"
            data-testid={`matrix-toolbar-${size}`}
          >
            <SearchInputGroup appearance="field" size={size} className="min-w-0 flex-1">
              <Search className="size-3 shrink-0" aria-hidden />
              <SearchInput
                aria-label={`${"Toolbar search"} ${size}`}
                focusOwner="group"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </SearchInputGroup>
            <Button size={size} data-testid={`matrix-toolbar-${size}-filter`}>
              {"Filter"}
            </Button>
            <Button
              size={size}
              variant="primary"
              iconOnly
              label={`${"Add"} ${size}`}
              data-testid={`matrix-toolbar-${size}-add`}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
          </div>
        ))}
      </MatrixGroup>
      <MatrixGroup
        name={"Tag input and search states"}
        testId="matrix-field-more"
        className="grid min-w-0 grid-cols-1 gap-3 @md:grid-cols-2"
      >
        <TagInput
          label="Tags with error"
          defaultValue={["alpha", "beta"]}
          error="At least three labels"
          description={"Press Enter to add"}
          removeLabel={(tag) => `Remove #${tag}`}
        />
        <PasswordField
          label="Password with error"
          defaultValue="matrix-only-value"
          error="Key rejected"
        />
        <SearchInputGroup appearance="field" data-testid="matrix-search-invalid">
          <Search className="size-3 shrink-0" aria-hidden />
          <SearchInput
            aria-label={"Invalid search"}
            aria-invalid="true"
            focusOwner="group"
            defaultValue="bad query"
          />
        </SearchInputGroup>
        <SearchInputGroup appearance="field" data-testid="matrix-search-readonly">
          <Search className="size-3 shrink-0" aria-hidden />
          <SearchInput
            aria-label={"Read only search"}
            readOnly
            focusOwner="group"
            defaultValue={"read only query"}
          />
        </SearchInputGroup>
        <SearchInputGroup appearance="field" data-testid="matrix-search-disabled">
          <Search className="size-3 shrink-0" aria-hidden />
          <SearchInput
            aria-label="Disabled search"
            disabled
            focusOwner="group"
            defaultValue="disabled query"
          />
        </SearchInputGroup>
      </MatrixGroup>
    </MatrixSection>
  );
}

function ChoicesMatrix() {
  const [select, setSelect] = useState("compact");
  const [searchable, setSearchable] = useState("long");
  const [multiple, setMultiple] = useState<string[]>(["ready", "missing"]);
  const [native, setNative] = useState("compact");
  const [morph, setMorph] = useState("compact");
  const [tags, setTags] = useState<string[]>(["alpha", "beta"]);
  const [mixed, setMixed] = useState<"on" | "off">("off");
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState("long-one");
  const [view, setView] = useState("list");
  const [environment, setEnvironment] = useState("dev");
  const [loaded, setLoaded] = useState(false);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [segment, setSegment] = useState("a");
  const environments = [
    { value: "dev", label: "Development" },
    { value: "stage", label: "Staging", disabled: true },
    { value: "prod", label: "Production" },
  ];
  const branches = [
    { value: "main", label: "main" },
    { value: "develop", label: "develop" },
    { value: "feature/login", label: "feature/login" },
    { value: "feature/search", label: "feature/search" },
  ];
  const bigList = useMemo(
    () =>
      Array.from({ length: 500 }, (_, index) => ({
        value: `v${index}`,
        label: `refs/heads/feature/branch-${index}`,
      })),
    [],
  );
  const longOption = "Project with a very long descriptive name that exceeds the field width";
  const short = [
    { value: "compact", label: "Compact" },
    { value: "comfortable", label: "Comfortable" },
  ];
  const searchableOptions = [
    { value: "long", label: longOption, description: "Available for selection" },
    { value: "short", label: "Short" },
    {
      value: "locked",
      label: "Locked option",
      description: "Permission required",
      disabled: true,
    },
  ];
  const segments = [
    { value: "long-one", label: "A long first segment label" },
    { value: "long-two", label: "A long second segment label" },
    { value: "short", label: "Short" },
  ];
  return (
    <MatrixSection name="Choices" testId="matrix-choices">
      <MatrixGroup
        name={"Single and searchable choices"}
        testId="matrix-choice-select"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <Select label="Matrix select" value={select} options={short} onValueChange={setSelect} />
        <Select
          label="Disabled select"
          value={select}
          options={short}
          onValueChange={setSelect}
          disabled
        />
        <SearchableSelect
          label="Matrix searchable"
          value={searchable}
          options={searchableOptions}
          onChange={setSearchable}
        />
        <SearchableSelect
          label="Disabled searchable"
          value={searchable}
          options={searchableOptions}
          onChange={setSearchable}
          disabled
        />
        <SearchableSelect
          multiple
          label="Matrix multiple"
          value={multiple}
          options={[
            { value: "ready", label: "Ready", description: "Available for selection" },
            { value: "long", label: longOption },
            { value: "locked", label: "Locked", disabled: true },
          ]}
          onChange={setMultiple}
          showSelectedValues
        />
        <NativeSearchableSelect
          label={"Matrix native select"}
          options={[...short, { value: "locked", label: "Locked option", disabled: true }]}
          value={native}
          onChange={(event) => setNative(event.currentTarget.value)}
        />
        <MorphSelect
          label="Matrix morph select"
          value={morph}
          options={short}
          onChange={setMorph}
        />
        <TagInput
          label="Matrix tags"
          value={tags}
          onValueChange={setTags}
          removeLabel={(tag) => `Remove #${tag}`}
        />
      </MatrixGroup>
      <MatrixGroup name="Checkboxes" testId="matrix-choice-checkbox">
        <label className="flex items-center gap-2">
          <Checkbox defaultChecked data-testid="matrix-checkbox-on" />
          {"Checked"}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox data-testid="matrix-checkbox-off" />
          {"Unchecked"}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            indeterminate={mixed === "off"}
            checked={mixed === "on"}
            onChange={(event) => setMixed(event.currentTarget.checked ? "on" : "off")}
            data-testid="matrix-checkbox-mixed"
          />
          {"Mixed"}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox disabled data-testid="matrix-checkbox-disabled" />
          {"Disabled unchecked"}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox disabled defaultChecked data-testid="matrix-checkbox-disabled-on" />
          {"Disabled checked"}
        </label>
      </MatrixGroup>
      <MatrixGroup name="Switches" testId="matrix-choice-switch">
        <Switch label="Matrix switch" checked={enabled} onCheckedChange={setEnabled} />
        <Switch label={"Switch on"} checked onCheckedChange={() => {}} />
        <Switch label="Disabled switch" checked={false} disabled onCheckedChange={() => {}} />
        <Switch label={"Disabled switch on"} checked disabled onCheckedChange={() => {}} />
      </MatrixGroup>
      <MatrixGroup
        name="Radio groups"
        testId="matrix-choice-radio"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <RadioGroup
          label="Matrix radios"
          defaultValue="review"
          options={[
            {
              value: "review",
              label: "Review first",
              description: "An owner reviews the prepared operation.",
            },
            { value: "manual", label: "Manual approval" },
            {
              value: "locked",
              label: "Unavailable approval",
              disabled: true,
              disabledReason: "Permission required",
            },
          ]}
        />
        <RadioGroup
          label="Compact radios"
          compact
          defaultValue="a"
          options={[
            { value: "a", label: "Option A" },
            { value: "b", label: "Option B" },
            { value: "c", label: "Option C", disabled: true },
          ]}
        />
      </MatrixGroup>
      <MatrixGroup
        name={"Segmented controls"}
        testId="matrix-choice-segmented"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        <SegmentedControl
          label={"Matrix segments"}
          value={mode}
          options={segments}
          onValueChange={setMode}
        />
        <div className="w-56 max-w-full">
          <SegmentedControl
            label={"Narrow segments"}
            value={mode}
            options={segments}
            onValueChange={setMode}
          />
        </div>
        <SegmentedControl
          label={"Pressed segments"}
          selectionRole="pressed"
          value={view}
          options={[
            { value: "list", label: "List" },
            { value: "grid", label: "Grid" },
          ]}
          onValueChange={setView}
        />
      </MatrixGroup>
      <MatrixGroup
        name={"Select options and committed values"}
        testId="matrix-choice-select-states"
        className="grid min-w-0 grid-cols-1 gap-3 @md:grid-cols-2"
      >
        <Select
          label={"Environment"}
          value={environment}
          onValueChange={setEnvironment}
          options={environments}
        />
        <Select
          label="Committed disabled value"
          value="stage"
          onValueChange={() => {}}
          options={environments}
        />
        <Select
          label={"Missing committed value"}
          value="gone"
          onValueChange={() => {}}
          options={environments}
        />
        <Select
          label={"Invalid select"}
          aria-invalid
          value="dev"
          onValueChange={() => {}}
          options={environments}
        />
      </MatrixGroup>
      <MatrixGroup
        name={"Searchable select async and list states"}
        testId="matrix-choice-async"
        className="grid min-w-0 grid-cols-1 gap-3 @md:grid-cols-2"
      >
        <SearchableSelect
          label={"Branch loading"}
          value="main"
          loading
          loadingLabel={"Loading branches…"}
          options={branches}
          onChange={() => {}}
        />
        <SearchableSelect
          label={"Branch with error"}
          value="main"
          error={loaded ? undefined : "Could not reach the host"}
          onRetry={() => setLoaded(true)}
          options={loaded ? branches : branches.slice(0, 2)}
          onChange={() => {}}
        />
        <SearchableSelect
          label="Empty projects"
          value=""
          options={[]}
          noOptionsLabel="No projects yet"
          emptyLabel={"No matching projects"}
          onChange={() => {}}
        />
        <SearchableSelect
          label="Filtered projects"
          value=""
          options={branches}
          noOptionsLabel="No projects yet"
          emptyLabel={"No matching projects"}
          onChange={() => {}}
        />
        <SearchableSelect
          multiple
          showSelectedValues
          label="Reviewers"
          value={reviewers}
          onChange={setReviewers}
          options={[
            {
              value: "a",
              label: longOption,
              description: "team-platform@example.com",
            },
            { value: "b", label: "Unavailable person", disabled: true },
            { value: "c", label: "Another reviewer" },
          ]}
        />
        <SearchableSelect label="Big list" value="v250" options={bigList} onChange={() => {}} />
      </MatrixGroup>
      <MatrixGroup
        name={"Segment availability"}
        testId="matrix-choice-segment-states"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        <SegmentedControl
          label={"Disabled segment"}
          value={segment}
          onValueChange={setSegment}
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta", disabled: true },
            { value: "c", label: "Gamma with a very long localized label", accessory: 3 },
            { value: "d", label: "Delta" },
          ]}
        />
        <div className="w-72 max-w-full">
          <SegmentedControl
            label={"Disabled pressed segment"}
            selectionRole="pressed"
            value={segment}
            onValueChange={setSegment}
            options={[
              { value: "a", label: "Alpha" },
              { value: "b", label: "Beta", disabled: true },
              { value: "c", label: "Gamma with a very long localized label" },
            ]}
          />
        </div>
      </MatrixGroup>
    </MatrixSection>
  );
}

function NavigationMatrix() {
  const [tab, setTab] = useState("one");
  const tabs = [
    { id: "one", label: "Selected tab" },
    { id: "two", label: "Other tab" },
    { id: "off", label: "Unavailable tab", disabled: true },
    { id: "long", label: "A tab label that is far too long to fit its tab" },
  ];
  return (
    <MatrixSection name={"Navigation"} testId="matrix-navigation">
      <MatrixGroup name="Tabs" testId="matrix-nav-tabs" className="grid min-w-0 grid-cols-1 gap-3">
        {[
          { name: "Matrix tabs", width: "max-w-full", items: tabs.slice(0, 3) },
          { name: "Narrow tabs", width: "w-56 max-w-full", items: [tabs[0], tabs[3]] },
        ].map((strip) => (
          <div
            key={strip.name}
            role="tablist"
            aria-label={strip.name}
            className={`flex gap-px overflow-hidden ${strip.width}`}
          >
            {strip.items.map((item) => (
              <Button
                key={item.id}
                variant="tab"
                role="tab"
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                disabled={item.disabled}
                selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className="min-w-0"
              >
                <TabLabel>{item.label}</TabLabel>
              </Button>
            ))}
          </div>
        ))}
      </MatrixGroup>
      <MatrixGroup
        name="Steppers"
        testId="matrix-nav-stepper"
        className="grid min-w-0 grid-cols-1 gap-4"
      >
        <Stepper
          label={"Horizontal steps"}
          current={2}
          steps={[
            { id: "account", label: "Account", description: "Signed in" },
            { id: "project", label: "Project", description: "Folder chosen" },
            { id: "review", label: "Review", description: "Check the summary" },
            { id: "publish", label: "Publish", description: "Not started" },
          ]}
        />
        <Stepper
          label={"Vertical steps with an error"}
          orientation="vertical"
          current={1}
          steps={[
            { id: "connect", label: "Connect", description: "Connected" },
            { id: "verify", label: "Verify", error: "Verification failed" },
            { id: "finish", label: "Finish", description: "Waiting" },
            { id: "locked", label: "Locked step", disabled: true },
          ]}
        />
        <Stepper
          compact
          label="Compact steps"
          current={1}
          steps={[
            { id: "a", label: "First" },
            { id: "b", label: "Second" },
            { id: "c", label: "Third" },
          ]}
        />
      </MatrixGroup>
      <MatrixGroup
        name={"Tab label truncation"}
        testId="matrix-nav-tabs-middle"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        {[180, 120].map((width) => (
          <div
            key={width}
            role="tablist"
            aria-label={`${"Truncating tabs"} ${width}`}
            data-testid={`matrix-tabs-middle-${width}`}
            style={{ inlineSize: width }}
            className="flex max-w-full gap-px overflow-hidden"
          >
            <Button variant="tab" role="tab" aria-selected tabIndex={0} className="min-w-0">
              <TabLabel truncate="middle" tail={12} title>
                {"Quarterly-report.final.v2.tsx"}
              </TabLabel>
              <TabDirtyDot />
            </Button>
          </div>
        ))}
        <div
          role="tablist"
          aria-label={"End truncating tab"}
          data-testid="matrix-tabs-end-120"
          className="flex w-[120px] max-w-full overflow-hidden"
        >
          <Button variant="tab" role="tab" aria-selected tabIndex={0} className="min-w-0">
            <TabLabel title>{"Quarterly-report.final.v2.tsx"}</TabLabel>
            <TabDirtyDot />
          </Button>
        </div>
      </MatrixGroup>
    </MatrixSection>
  );
}

function TreeMatrix() {
  const [selected, setSelected] = useState("selected");
  const rows: {
    id: string;
    name: string;
    depth: number;
    dir?: boolean;
    cut?: boolean;
    drop?: boolean;
    disabled?: boolean;
    count?: number;
  }[] = [
    { id: "depth0", name: "depth 0 folder", depth: 0, dir: true },
    { id: "depth1", name: "depth 1 folder", depth: 1, dir: true },
    { id: "depth2", name: "depth 2 folder", depth: 2, dir: true },
    { id: "depth3", name: "depth 3 file.ts", depth: 3 },
    { id: "selected", name: "selected file.ts", depth: 1 },
    { id: "drop", name: "drop target folder", depth: 1, dir: true, drop: true },
    { id: "selected-drop", name: "selected drop target", depth: 1, dir: true, drop: true },
    { id: "cut", name: "cut file.ts", depth: 1, cut: true },
    { id: "disabled", name: "disabled file.ts", depth: 1, disabled: true },
    {
      id: "long",
      name: "a-very-long-file-name-that-has-to-truncate-before-it-pushes-the-row-wider.test.tsx",
      depth: 2,
      count: 128,
    },
  ];
  return (
    <MatrixSection name="Tree rows" testId="matrix-tree">
      <div
        role="tree"
        aria-label="Matrix tree"
        data-testid="matrix-tree-rows"
        className="w-72 max-w-full"
      >
        {rows.map((row) => (
          <TreeRow
            key={row.id}
            data-testid={`matrix-tree-${row.id}`}
            depth={row.depth}
            selected={row.id === selected || row.id === "selected-drop"}
            dropTarget={row.drop}
            cut={row.cut}
            disabled={row.disabled}
            aria-expanded={row.dir ? true : undefined}
            title={row.name}
            onClick={() => setSelected(row.id)}
          >
            <TreeRowToggle>
              {row.dir ? <ChevronRight className="size-3.5" aria-hidden /> : null}
            </TreeRowToggle>
            <TreeRowIcon>
              {row.dir ? (
                <FolderOpen className="size-3.5" aria-hidden />
              ) : (
                <File className="size-3.5" aria-hidden />
              )}
            </TreeRowIcon>
            <TreeRowLabel>{row.name}</TreeRowLabel>
            {row.count ? <TreeRowTrailing>{row.count}</TreeRowTrailing> : null}
          </TreeRow>
        ))}
      </div>
    </MatrixSection>
  );
}

const INLINE_TABS = [
  { id: "readme", name: "README.md" },
  { id: "panel", name: "GitChangesPanel.tsx", dirty: true },
  { id: "long", name: "A tab with a very long title that has to truncate.tsx" },
];
const INLINE_ROWS = [
  { id: "inbox", name: "Review the inbox triage", meta: "3 open" },
  { id: "release", name: "Prepare release notes", meta: "Today" },
  { id: "pinned", name: "Pinned row keeps its action visible", meta: "Pinned", always: true },
];

/** Rows, tabs and cards that own their highlight while holding compact inline actions. */
function InlineActionsMatrix() {
  const [tabs, setTabs] = useState(INLINE_TABS);
  const [activeTab, setActiveTab] = useState("panel");
  const [activeRow, setActiveRow] = useState("release");
  const [log, setLog] = useState("");
  const close = (id: string) => {
    setTabs((current) => current.filter((tab) => tab.id !== id));
    setLog(`closed ${id}`);
  };
  return (
    <MatrixSection name="Inline actions" testId="matrix-inline">
      <MatrixGroup
        name="Tab and close"
        testId="matrix-inline-tabs"
        className="flex min-w-0 items-center gap-1"
      >
        <div role="tablist" aria-label="Inline tabs" className="flex min-w-0 items-center gap-1">
          {tabs.map((tab) => (
            <ActionHost
              key={tab.id}
              selected={tab.id === activeTab}
              data-testid={`matrix-inline-tab-${tab.id}`}
              className="max-w-56 pe-1"
              // Middle click closes the tab; it never reaches the close action twice.
              onAuxClick={(event) => {
                if (event.button === 1) close(tab.id);
              }}
            >
              <Button
                variant="tab"
                role="tab"
                aria-selected={tab.id === activeTab}
                motion="none"
                align="start"
                className="min-w-0 flex-1"
                onClick={() => {
                  setActiveTab(tab.id);
                  setLog(`selected ${tab.id}`);
                }}
              >
                <TabLabel truncate="middle" title>
                  {tab.name}
                </TabLabel>
                {tab.dirty ? <TabDirtyDot /> : null}
              </Button>
              <InlineAction
                label={`Close ${tab.name}`}
                data-testid={`matrix-inline-close-${tab.id}`}
                onClick={() => close(tab.id)}
              >
                <X aria-hidden />
              </InlineAction>
            </ActionHost>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          motion="none"
          onClick={() => {
            setTabs(INLINE_TABS);
            setLog("reset");
          }}
        >
          Reset tabs
        </Button>
      </MatrixGroup>
      <MatrixGroup
        name="Rows and actions"
        testId="matrix-inline-rows"
        className="grid w-80 max-w-full grid-cols-1 gap-0.5"
      >
        {INLINE_ROWS.map((row) => (
          <ActionHost
            key={row.id}
            selected={row.id === activeRow}
            data-testid={`matrix-inline-row-${row.id}`}
            className="pe-1"
          >
            <Button
              variant="item"
              motion="none"
              align="start"
              aria-current={row.id === activeRow ? "true" : undefined}
              className="min-w-0 flex-1"
              onClick={() => {
                setActiveRow(row.id);
                setLog(`opened ${row.id}`);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="shrink-0 text-ui-caption text-(--ui-text-secondary)">
                {row.meta}
              </span>
            </Button>
            <InlineAction
              label={`More actions for ${row.name}`}
              reveal={row.always ? "always" : "interaction"}
              data-testid={`matrix-inline-more-${row.id}`}
              onClick={() => setLog(`more ${row.id}`)}
            >
              <MoreHorizontal aria-hidden />
            </InlineAction>
            <InlineAction
              label={`Remove ${row.name}`}
              reveal={row.always ? "always" : "interaction"}
              data-testid={`matrix-inline-remove-${row.id}`}
              onClick={() => setLog(`removed ${row.id}`)}
            >
              <X aria-hidden />
            </InlineAction>
          </ActionHost>
        ))}
      </MatrixGroup>
      <MatrixGroup
        name="Tree row and action"
        testId="matrix-inline-tree"
        className="w-72 max-w-full"
      >
        {/* A row and its action are siblings in the host (no nested interactives); the
            host paints the selected fill. Tree semantics stay with the feature controller. */}
        <div>
          <ActionHost selected data-testid="matrix-inline-tree-row" className="pe-1">
            <TreeRow depth={1} role="button" aria-label="selected file.ts">
              <TreeRowToggle />
              <TreeRowIcon>
                <File className="size-3.5" aria-hidden />
              </TreeRowIcon>
              <TreeRowLabel>selected file.ts</TreeRowLabel>
            </TreeRow>
            <InlineAction
              label="More actions for selected file.ts"
              onClick={() => setLog("more tree")}
            >
              <MoreHorizontal aria-hidden />
            </InlineAction>
          </ActionHost>
        </div>
      </MatrixGroup>
      <p data-testid="matrix-inline-log" className="text-ui-caption text-(--ui-text-secondary)">
        {log || "No action yet"}
      </p>
    </MatrixSection>
  );
}

/** F3 contract: caller utilities change placement only; internal presentation stays owned. */
function PlacementMatrix() {
  return (
    <MatrixSection name="Caller placement" testId="matrix-placement">
      <MatrixGroup
        name="Width and margin utilities"
        testId="matrix-placement-group"
        className="grid min-w-0 grid-cols-1 gap-2"
      >
        <TextField
          label="Placed field"
          className="w-40 px-10 text-ui-title"
          data-testid="matrix-placement-field"
        />
        <Select
          label="Placed select"
          value="a"
          className="w-40"
          data-testid="matrix-placement-select"
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          onValueChange={() => undefined}
        />
        <SegmentedControl
          label="Placed segments"
          value="one"
          className="ms-6"
          options={[
            { value: "one", label: "One" },
            { value: "two", label: "Two" },
          ]}
          onValueChange={() => undefined}
        />
        <Button className="w-48" motion="none" data-testid="matrix-placement-button">
          Placed button
        </Button>
        {/* ConfirmDialog-style action: a loading contract but no icon reserves no empty slot. */}
        <div className="flex gap-2">
          <Button loading={false} variant="primary" tone="danger" data-testid="matrix-loading-idle">
            Delete
          </Button>
          <Button loading variant="primary" tone="danger" data-testid="matrix-loading-busy">
            Delete
          </Button>
          <Button
            loading={false}
            startIcon={<Copy aria-hidden />}
            data-testid="matrix-loading-icon"
          >
            Copy
          </Button>
        </div>
      </MatrixGroup>
    </MatrixSection>
  );
}

function TextMatrix() {
  const [now] = useState(() => Date.now());
  const path = "src/shared/ui/SearchableSelect.tsx";
  return (
    <MatrixSection name="Text" testId="matrix-text">
      <MatrixGroup
        name="Match text"
        testId="matrix-text-match"
        className="grid min-w-0 grid-cols-1 gap-1"
      >
        <span data-testid="matrix-match-active" className="min-w-0 truncate">
          <MatchText text={path} positions={matchPositions(path, "select")} active />
        </span>
        <span data-testid="matrix-match-inactive" className="min-w-0 truncate">
          <MatchText text={path} positions={matchPositions(path, "select")} active={false} />
        </span>
      </MatrixGroup>
      <MatrixGroup name="Timestamps" testId="matrix-text-time">
        <Timestamp value={now} data-testid="matrix-time-today" />
        <Timestamp value={now - 24 * 60 * 60 * 1000} data-testid="matrix-time-yesterday" />
        <Timestamp value={1_800_000_000_000} data-testid="matrix-time-fixed" />
      </MatrixGroup>
      <MatrixGroup name="Shortcuts" testId="matrix-text-shortcut">
        <ShortcutKbd size="xs">K</ShortcutKbd>
        <ShortcutKbd size="sm">Enter</ShortcutKbd>
        <ShortcutKbd size="md">Esc</ShortcutKbd>
        <ShortcutKeys shortcut="Mod+Shift+K" />
        <ShortcutKeys shortcut="Mod+K" size="sm" />
      </MatrixGroup>
      <MatrixGroup
        name={"Middle truncation"}
        testId="matrix-text-middle"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        {[160, 480].map((width) => (
          <div
            key={width}
            className="grid max-w-full gap-1"
            style={{ inlineSize: width }}
            data-testid={`matrix-middle-${width}`}
          >
            <div className="flex min-w-0" data-testid={`matrix-middle-path-${width}`}>
              <MiddleTruncate className="min-w-0 flex-1">
                src/features/source-control/ui/GitChangesPanel.component.test.tsx
              </MiddleTruncate>
            </div>
            <div className="flex min-w-0" data-testid={`matrix-middle-branch-${width}`}>
              <MiddleTruncate>feature/PROJ-123-add-login-redirect</MiddleTruncate>
            </div>
            <div className="flex min-w-0" data-testid={`matrix-middle-model-${width}`}>
              <MiddleTruncate>claude-opus-4-1-20250805</MiddleTruncate>
            </div>
          </div>
        ))}
      </MatrixGroup>
    </MatrixSection>
  );
}

/**
 * Complete real-control state matrix for browser fixtures. It uses current public APIs with
 * memory-only state, so captures show actual adapter output. `layout` stresses narrow
 * containers and short panes without changing any control.
 */
export function ControlStateMatrix({
  initialLayout = "default",
}: {
  initialLayout?: ControlMatrixLayout;
}) {
  const [layout, setLayout] = useState<ControlMatrixLayout>(initialLayout);
  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-5"
      data-testid="control-matrix"
      data-matrix-layout={layout}
    >
      <SegmentedControl
        label="Matrix layout"
        value={layout}
        options={[
          { value: "default", label: "Default" },
          { value: "narrow", label: "Narrow" },
          { value: "short", label: "Short" },
        ]}
        onValueChange={(next) => setLayout(next as ControlMatrixLayout)}
      />
      <div
        data-testid="control-matrix-body"
        className={[
          "@container grid min-w-0 grid-cols-1 gap-8",
          layout === "narrow" ? "w-80 max-w-full" : "",
          layout === "short" ? "max-h-72 overflow-auto pe-2" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <ActionsMatrix />
        <FieldsMatrix />
        <ChoicesMatrix />
        <NavigationMatrix />
        <TreeMatrix />
        <InlineActionsMatrix />
        <PlacementMatrix />
        <TextMatrix />
      </div>
    </div>
  );
}
