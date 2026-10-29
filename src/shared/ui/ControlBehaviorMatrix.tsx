import { useT } from "../i18n";
import { useMemo, useState, type ReactNode } from "react";
import { ActionHost, InlineAction } from "./ActionHost";
import { Button } from "./Button";
import { ButtonGroup } from "./ButtonGroup";
import { SplitButton } from "./SplitButton";
import { ExpandingButtonGroup } from "./ExpandingButtonGroup";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { SegmentedControl } from "./SegmentedControl";
import { NumberField } from "./NumberField";
import { DateRangePicker } from "./DateRangePicker";
import { PasswordField } from "./PasswordField";
import { RadioGroup } from "./RadioGroup";
import { TagInput } from "./TagInput";
import { NativeSearchableSelect } from "./NativeSearchableSelect";
import { SearchableSelect } from "./SearchableSelect";
import { MorphSelect } from "./MorphSelect";
import { SearchInput, SearchInputGroup } from "./SearchInput";
import { InlineEdit } from "./InlineEdit";
import { Checkbox } from "./Checkbox";
import { TabDirtyDot, TabLabel } from "./TabLabel";
import { MiddleTruncate } from "./MiddleTruncate";
import { Stepper } from "./Stepper";
import { TreeRow, TreeRowIcon, TreeRowLabel, TreeRowToggle, TreeRowTrailing } from "./TreeRow";
import { MatchText, matchPositions } from "./MatchText";
import { Timestamp } from "./Timestamp";
import { ShortcutKbd, ShortcutKeys } from "./ShortcutKbd";
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
} from "./icons";

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
  const t = useT();
  const [count, setCount] = useState(0);
  const [pressed, setPressed] = useState(false);
  const bump = () => setCount((value) => value + 1);
  const names: Record<string, string> = {
    primary: t("Primary"),
    secondary: t("Secondary"),
    ghost: t("Ghost"),
    danger: t("Danger"),
    link: t("Link"),
    neutral: t("Neutral"),
    accent: t("Accent"),
    info: t("Info"),
    success: t("Success"),
    warning: t("Warning"),
  };
  const label = (name: string) => names[name] ?? name;
  const longLabel = t(
    "A deliberately long action label that must wrap or truncate without overflow",
  );
  return (
    <MatrixSection name={t("Actions")} testId="matrix-actions">
      <MatrixGroup
        name={t("Variants by size")}
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
      <MatrixGroup name={t("Icon only by size")} testId="matrix-action-icons">
        {(["secondary", "ghost"] as const).map((variant) =>
          SIZES.map((size) => (
            <Button
              key={`${variant}-${size}`}
              variant={variant}
              size={size}
              iconOnly
              label={`${label(variant)} ${size} ${t("icon")}`}
              tooltip={`${label(variant)} ${size} ${t("icon")}`}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
          )),
        )}
      </MatrixGroup>
      <MatrixGroup name={t("Tones")} testId="matrix-action-tones">
        {(["neutral", "accent", "info", "success", "warning", "danger"] as const).map((tone) => (
          <Button key={tone} tone={tone}>
            {label(tone)}
          </Button>
        ))}
      </MatrixGroup>
      <MatrixGroup name={t("States")} testId="matrix-action-states">
        <Button onClick={bump}>{t("Count action")}</Button>
        <Button
          loading
          loadingLabel={t("Saving…")}
          data-testid="matrix-loading-text"
          onClick={bump}
        >
          {t("Loading action")}
        </Button>
        <Button
          loading
          iconOnly
          variant="ghost"
          label={t("Loading icon action")}
          data-testid="matrix-loading-icon"
          onClick={bump}
        >
          <Search className="size-3.5" aria-hidden />
        </Button>
        <Button disabled onClick={bump}>
          {t("Disabled action")}
        </Button>
        <Button disabled iconOnly variant="ghost" label={t("Disabled icon action")}>
          <Plus className="size-3.5" aria-hidden />
        </Button>
        <Button
          selected={pressed}
          aria-pressed={pressed}
          onClick={() => setPressed((value) => !value)}
        >
          {t("Selected action")}
        </Button>
        <Button variant="primary" disabled>
          {t("Disabled primary")}
        </Button>
        <output aria-label={t("Action count")} data-testid="matrix-action-count">
          {count}
        </output>
      </MatrixGroup>
      <MatrixGroup name={t("Long label in a narrow container")} testId="matrix-action-long">
        <div className="grid w-48 min-w-0 max-w-full gap-2" data-testid="matrix-action-narrow">
          <Button fullWidth>{longLabel}</Button>
          <Button fullWidth variant="primary" startIcon={<Plus className="size-3.5" aria-hidden />}>
            {longLabel}
          </Button>
        </div>
      </MatrixGroup>
      <MatrixGroup name={t("Joined and split actions")} testId="matrix-action-groups">
        <ButtonGroup aria-label={t("Joined actions")}>
          <Button selected aria-pressed>
            {t("Day")}
          </Button>
          <Button disabled>{t("Week")}</Button>
          <Button>{t("Month")}</Button>
        </ButtonGroup>
        <SplitButton
          label={t("Split primary")}
          menuLabel={t("Split primary options")}
          actions={[
            { id: "one", label: t("First option"), onSelect: bump },
            { id: "two", label: t("Second option"), onSelect: bump },
          ]}
          onClick={bump}
        />
        <SplitButton
          label={t("Split blocked")}
          menuLabel={t("Split blocked options")}
          disabled
          menuDisabled={false}
          actions={[{ id: "one", label: t("Available option"), onSelect: bump }]}
        />
        <SplitButton
          label={t("Split loading")}
          menuLabel={t("Split loading options")}
          loading
          actions={[{ id: "one", label: t("Unavailable option"), onSelect: bump }]}
        />
        <ExpandingButtonGroup
          label={t("Expanding actions")}
          items={[
            { id: "copy", label: t("Copy item"), icon: <Copy />, onSelect: bump },
            { id: "add", label: t("Add item"), icon: <Plus />, onSelect: bump },
          ]}
        />
      </MatrixGroup>
      <MatrixGroup
        name={t("Joined seams and split variants")}
        testId="matrix-action-seams"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <ButtonGroup aria-label={t("Review")}>
            <Button variant="ghost" startIcon={<Check className="size-3.5" aria-hidden />}>
              {t("Approve")}
            </Button>
            <Button variant="ghost" disabled>
              {t("Request changes")}
            </Button>
            <Button variant="ghost" selected aria-pressed>
              {t("Comment")}
            </Button>
            <Button variant="ghost" loading loadingLabel={t("Merging")}>
              {t("Merge")}
            </Button>
          </ButtonGroup>
          <ButtonGroup aria-label={t("Secondary joined")}>
            <Button variant="secondary">{t("One")}</Button>
            <Button variant="secondary">{t("Two")}</Button>
            <Button variant="secondary" iconOnly label={t("More joined actions")}>
              <MoreHorizontal className="size-3.5" aria-hidden />
            </Button>
          </ButtonGroup>
          <ButtonGroup aria-label={t("Primary joined")}>
            <Button variant="primary">{t("Save")}</Button>
            <Button variant="primary" iconOnly label={t("Save options")}>
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
            label={t("Commit")}
            menuLabel={t("Commit options")}
            actions={[{ id: "one", label: t("Commit and push"), onSelect: bump }]}
          />
          <SplitButton
            variant="primary"
            label={t("Commit blocked")}
            menuLabel={t("Commit blocked options")}
            disabled
            menuDisabled={false}
            actions={[{ id: "one", label: t("Amend commit"), onSelect: bump }]}
          />
          <SplitButton
            variant="primary"
            label={t("Committing")}
            menuLabel={t("Committing options")}
            loading
            actions={[{ id: "one", label: t("Cancel commit"), onSelect: bump }]}
          />
          <SplitButton
            variant="secondary"
            size="md"
            label={t("Merge pull request")}
            menuLabel={t("Merge options")}
            menuDisabled
            actions={[{ id: "one", label: t("Squash and merge"), onSelect: bump }]}
          />
          <SplitButton
            variant="ghost"
            label={t("Shell")}
            menuLabel={t("Shell options")}
            actions={[{ id: "one", label: t("New shell"), onSelect: bump }]}
          />
        </div>
        <div className="w-64 max-w-full" data-testid="matrix-split-full">
          <SplitButton
            variant="primary"
            fullWidth
            label={t("Commit everything")}
            menuLabel={t("Commit everything options")}
            actions={[{ id: "one", label: t("Commit all and push"), onSelect: bump }]}
          />
        </div>
        <div className="flex min-w-0">
          <Button
            variant="secondary"
            startIcon={<GitMerge className="size-3.5" aria-hidden />}
            data-testid="matrix-merge-start-icon"
          >
            {t("Merge with icon")}
          </Button>
        </div>
      </MatrixGroup>
      <MatrixGroup name={t("Tab alignment")} testId="matrix-action-align">
        <div role="tablist" aria-label={t("Aligned tabs")} className="grid w-56 max-w-full gap-1">
          <Button
            variant="tab"
            role="tab"
            aria-selected
            tabIndex={0}
            align="start"
            data-testid="matrix-tab-start"
          >
            {t("Explorer root")}
          </Button>
          <Button
            variant="tab"
            role="tab"
            aria-selected={false}
            tabIndex={-1}
            data-testid="matrix-tab-default"
          >
            {t("Default centered tab")}
          </Button>
          <Button
            variant="tab"
            role="tab"
            aria-selected={false}
            tabIndex={-1}
            align="end"
            data-testid="matrix-tab-end"
          >
            {t("End aligned")}
          </Button>
        </div>
      </MatrixGroup>
    </MatrixSection>
  );
}

function FieldsMatrix() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("Review notes");
  const longValue = t("Project with a very long descriptive name that exceeds the field width");
  return (
    <MatrixSection name={t("Fields")} testId="matrix-fields">
      <MatrixGroup
        name={t("Text fields")}
        testId="matrix-field-text"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <TextField label={t("Plain field")} defaultValue="Editable value" />
        <TextField
          label={t("Field with helper")}
          description={t(
            "Helper text explains the expected value and may wrap onto a second line.",
          )}
          placeholder={t("Placeholder")}
        />
        <TextField label={t("Field with error")} error={t("This value is required")} required />
        <TextField label={t("Read only field")} readOnly defaultValue="Selectable value" />
        <TextField label={t("Disabled field")} disabled defaultValue="Unavailable value" />
        <TextField label={t("Required field")} required />
        <TextField
          label={t("Clearable field")}
          clearable
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <TextField label={t("Long value field")} defaultValue={longValue + longValue} />
      </MatrixGroup>
      <MatrixGroup
        name={t("Password, number and text area")}
        testId="matrix-field-special"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <PasswordField
          label={t("Matrix password")}
          defaultValue="matrix-only-value"
          autoComplete="off"
          messages={{
            showPassword: t("Show matrix password"),
            hidePassword: t("Hide matrix password"),
          }}
        />
        <PasswordField label={t("Disabled password")} disabled defaultValue="matrix-only-value" />
        <NumberField label={t("Matrix number")} defaultValue={10} min={0} max={20} step={1} />
        <NumberField
          label={t("Number with error")}
          error={t("Enter a value between 0 and 20")}
          defaultValue={40}
        />
        <NumberField label={t("Number at its maximum")} defaultValue={20} min={0} max={20} />
        <NumberField label={t("Read only number")} readOnly defaultValue={5} />
        <NumberField label={t("Disabled number")} disabled defaultValue={5} />
        <NumberField label={t("Number without steppers")} steppers={false} defaultValue={3} />
        <TextareaField
          label={t("Matrix text area")}
          rows={2}
          description={t("Helper for a text area")}
        />
        <TextareaField
          label={t("Text area with error")}
          rows={2}
          error={t("A description is required")}
        />
        <TextareaField
          label={t("Read only text area")}
          rows={2}
          readOnly
          defaultValue="Selectable text"
        />
        <TextareaField label={t("Disabled text area")} rows={2} disabled />
      </MatrixGroup>
      <MatrixGroup
        name={t("Date range states")}
        testId="matrix-field-dates"
        className="flex min-w-0 flex-wrap items-start gap-2"
      >
        <DateRangePicker label={t("Matrix range")} />
        <DateRangePicker label={t("Disabled range")} disabled />
        <DateRangePicker label={t("Read only range")} readOnly />
        <DateRangePicker label={t("Invalid range")} invalid />
      </MatrixGroup>
      <MatrixGroup name={t("Inline editing")} testId="matrix-field-inline">
        <InlineEdit label={t("Matrix title")} value={title} onSave={(next) => setTitle(next)} />
      </MatrixGroup>
      <MatrixGroup
        name={t("Compact search beside actions")}
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
                aria-label={`${t("Toolbar search")} ${size}`}
                focusOwner="group"
                placeholder={t("Search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </SearchInputGroup>
            <Button size={size} data-testid={`matrix-toolbar-${size}-filter`}>
              {t("Filter")}
            </Button>
            <Button
              size={size}
              variant="primary"
              iconOnly
              label={`${t("Add")} ${size}`}
              data-testid={`matrix-toolbar-${size}-add`}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
          </div>
        ))}
      </MatrixGroup>
      <MatrixGroup
        name={t("Tag input and search states")}
        testId="matrix-field-more"
        className="grid min-w-0 grid-cols-1 gap-3 @md:grid-cols-2"
      >
        <TagInput
          label={t("Tags with error")}
          defaultValue={["alpha", "beta"]}
          error={t("At least three labels")}
          description={t("Press Enter to add")}
          removeLabel={(tag) => t("Remove #{p0}", { p0: tag })}
        />
        <PasswordField
          label={t("Password with error")}
          defaultValue="matrix-only-value"
          error={t("Key rejected")}
        />
        <SearchInputGroup appearance="field" data-testid="matrix-search-invalid">
          <Search className="size-3 shrink-0" aria-hidden />
          <SearchInput
            aria-label={t("Invalid search")}
            aria-invalid="true"
            focusOwner="group"
            defaultValue="bad query"
          />
        </SearchInputGroup>
        <SearchInputGroup appearance="field" data-testid="matrix-search-readonly">
          <Search className="size-3 shrink-0" aria-hidden />
          <SearchInput
            aria-label={t("Read only search")}
            readOnly
            focusOwner="group"
            defaultValue="read only query"
          />
        </SearchInputGroup>
        <SearchInputGroup appearance="field" data-testid="matrix-search-disabled">
          <Search className="size-3 shrink-0" aria-hidden />
          <SearchInput
            aria-label={t("Disabled search")}
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
  const t = useT();
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
    { value: "dev", label: t("Development") },
    { value: "stage", label: t("Staging"), disabled: true },
    { value: "prod", label: t("Production") },
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
  const longOption = t("Project with a very long descriptive name that exceeds the field width");
  const short = [
    { value: "compact", label: t("Compact") },
    { value: "comfortable", label: t("Comfortable") },
  ];
  const searchableOptions = [
    { value: "long", label: longOption, description: t("Available for selection") },
    { value: "short", label: t("Short") },
    {
      value: "locked",
      label: t("Locked option"),
      description: t("Permission required"),
      disabled: true,
    },
  ];
  const segments = [
    { value: "long-one", label: t("A long first segment label") },
    { value: "long-two", label: t("A long second segment label") },
    { value: "short", label: t("Short") },
  ];
  return (
    <MatrixSection name={t("Choices")} testId="matrix-choices">
      <MatrixGroup
        name={t("Single and searchable choices")}
        testId="matrix-choice-select"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <Select
          label={t("Matrix select")}
          value={select}
          options={short}
          onValueChange={setSelect}
        />
        <Select
          label={t("Disabled select")}
          value={select}
          options={short}
          onValueChange={setSelect}
          disabled
        />
        <SearchableSelect
          label={t("Matrix searchable")}
          value={searchable}
          options={searchableOptions}
          onChange={setSearchable}
        />
        <SearchableSelect
          label={t("Disabled searchable")}
          value={searchable}
          options={searchableOptions}
          onChange={setSearchable}
          disabled
        />
        <SearchableSelect
          multiple
          label={t("Matrix multiple")}
          value={multiple}
          options={[
            { value: "ready", label: t("Ready"), description: t("Available for selection") },
            { value: "long", label: longOption },
            { value: "locked", label: t("Locked"), disabled: true },
          ]}
          onChange={setMultiple}
          showSelectedValues
        />
        <NativeSearchableSelect
          label={t("Matrix native select")}
          options={[...short, { value: "locked", label: t("Locked option"), disabled: true }]}
          value={native}
          onChange={(event) => setNative(event.currentTarget.value)}
        />
        <MorphSelect
          label={t("Matrix morph select")}
          value={morph}
          options={short}
          onChange={setMorph}
        />
        <TagInput
          label={t("Matrix tags")}
          value={tags}
          onValueChange={setTags}
          removeLabel={(tag) => t("Remove #{p0}", { p0: tag })}
        />
      </MatrixGroup>
      <MatrixGroup name={t("Checkboxes")} testId="matrix-choice-checkbox">
        <label className="flex items-center gap-2">
          <Checkbox defaultChecked data-testid="matrix-checkbox-on" />
          {t("Checked")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox data-testid="matrix-checkbox-off" />
          {t("Unchecked")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            indeterminate={mixed === "off"}
            checked={mixed === "on"}
            onChange={(event) => setMixed(event.currentTarget.checked ? "on" : "off")}
            data-testid="matrix-checkbox-mixed"
          />
          {t("Mixed")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox disabled data-testid="matrix-checkbox-disabled" />
          {t("Disabled unchecked")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox disabled defaultChecked data-testid="matrix-checkbox-disabled-on" />
          {t("Disabled checked")}
        </label>
      </MatrixGroup>
      <MatrixGroup name={t("Switches")} testId="matrix-choice-switch">
        <Switch label={t("Matrix switch")} checked={enabled} onCheckedChange={setEnabled} />
        <Switch label={t("Switch on")} checked onCheckedChange={() => {}} />
        <Switch label={t("Disabled switch")} checked={false} disabled onCheckedChange={() => {}} />
        <Switch label={t("Disabled switch on")} checked disabled onCheckedChange={() => {}} />
      </MatrixGroup>
      <MatrixGroup
        name={t("Radio groups")}
        testId="matrix-choice-radio"
        className="grid min-w-0 gap-3 @md:grid-cols-2"
      >
        <RadioGroup
          label={t("Matrix radios")}
          defaultValue="review"
          options={[
            {
              value: "review",
              label: t("Review first"),
              description: t("An owner reviews the prepared operation."),
            },
            { value: "manual", label: t("Manual approval") },
            {
              value: "locked",
              label: t("Unavailable approval"),
              disabled: true,
              disabledReason: t("Permission required"),
            },
          ]}
        />
        <RadioGroup
          label={t("Compact radios")}
          compact
          defaultValue="a"
          options={[
            { value: "a", label: t("Option A") },
            { value: "b", label: t("Option B") },
            { value: "c", label: t("Option C"), disabled: true },
          ]}
        />
      </MatrixGroup>
      <MatrixGroup
        name={t("Segmented controls")}
        testId="matrix-choice-segmented"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        <SegmentedControl
          label={t("Matrix segments")}
          value={mode}
          options={segments}
          onValueChange={setMode}
        />
        <div className="w-56 max-w-full">
          <SegmentedControl
            label={t("Narrow segments")}
            value={mode}
            options={segments}
            onValueChange={setMode}
          />
        </div>
        <SegmentedControl
          label={t("Pressed segments")}
          selectionRole="pressed"
          value={view}
          options={[
            { value: "list", label: t("List") },
            { value: "grid", label: t("Grid") },
          ]}
          onValueChange={setView}
        />
      </MatrixGroup>
      <MatrixGroup
        name={t("Select options and committed values")}
        testId="matrix-choice-select-states"
        className="grid min-w-0 grid-cols-1 gap-3 @md:grid-cols-2"
      >
        <Select
          label={t("Environment")}
          value={environment}
          onValueChange={setEnvironment}
          options={environments}
        />
        <Select
          label={t("Committed disabled value")}
          value="stage"
          onValueChange={() => {}}
          options={environments}
        />
        <Select
          label={t("Missing committed value")}
          value="gone"
          onValueChange={() => {}}
          options={environments}
        />
        <Select
          label={t("Invalid select")}
          aria-invalid
          value="dev"
          onValueChange={() => {}}
          options={environments}
        />
      </MatrixGroup>
      <MatrixGroup
        name={t("Searchable select async and list states")}
        testId="matrix-choice-async"
        className="grid min-w-0 grid-cols-1 gap-3 @md:grid-cols-2"
      >
        <SearchableSelect
          label={t("Branch loading")}
          value="main"
          loading
          loadingLabel={t("Loading branches…")}
          options={branches}
          onChange={() => {}}
        />
        <SearchableSelect
          label={t("Branch with error")}
          value="main"
          error={loaded ? undefined : t("Could not reach the host")}
          onRetry={() => setLoaded(true)}
          options={loaded ? branches : branches.slice(0, 2)}
          onChange={() => {}}
        />
        <SearchableSelect
          label={t("Empty projects")}
          value=""
          options={[]}
          noOptionsLabel={t("No projects yet")}
          emptyLabel={t("No matching projects")}
          onChange={() => {}}
        />
        <SearchableSelect
          label={t("Filtered projects")}
          value=""
          options={branches}
          noOptionsLabel={t("No projects yet")}
          emptyLabel={t("No matching projects")}
          onChange={() => {}}
        />
        <SearchableSelect
          multiple
          showSelectedValues
          label={t("Reviewers")}
          value={reviewers}
          onChange={setReviewers}
          options={[
            {
              value: "a",
              label: longOption,
              description: "team-platform@example.com",
            },
            { value: "b", label: t("Unavailable person"), disabled: true },
            { value: "c", label: t("Another reviewer") },
          ]}
        />
        <SearchableSelect
          label={t("Big list")}
          value="v250"
          options={bigList}
          onChange={() => {}}
        />
      </MatrixGroup>
      <MatrixGroup
        name={t("Segment availability")}
        testId="matrix-choice-segment-states"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        <SegmentedControl
          label={t("Disabled segment")}
          value={segment}
          onValueChange={setSegment}
          options={[
            { value: "a", label: t("Alpha") },
            { value: "b", label: t("Beta"), disabled: true },
            { value: "c", label: t("Gamma with a very long localized label"), accessory: 3 },
            { value: "d", label: t("Delta") },
          ]}
        />
        <div className="w-72 max-w-full">
          <SegmentedControl
            label={t("Disabled pressed segment")}
            selectionRole="pressed"
            value={segment}
            onValueChange={setSegment}
            options={[
              { value: "a", label: t("Alpha") },
              { value: "b", label: t("Beta"), disabled: true },
              { value: "c", label: t("Gamma with a very long localized label") },
            ]}
          />
        </div>
      </MatrixGroup>
    </MatrixSection>
  );
}

function NavigationMatrix() {
  const t = useT();
  const [tab, setTab] = useState("one");
  const tabs = [
    { id: "one", label: t("Selected tab") },
    { id: "two", label: t("Other tab") },
    { id: "off", label: t("Unavailable tab"), disabled: true },
    { id: "long", label: t("A tab label that is far too long to fit its tab") },
  ];
  return (
    <MatrixSection name={t("Navigation")} testId="matrix-navigation">
      <MatrixGroup
        name={t("Tabs")}
        testId="matrix-nav-tabs"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
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
        name={t("Steppers")}
        testId="matrix-nav-stepper"
        className="grid min-w-0 grid-cols-1 gap-4"
      >
        <Stepper
          label={t("Horizontal steps")}
          current={2}
          steps={[
            { id: "account", label: t("Account"), description: t("Signed in") },
            { id: "project", label: t("Project"), description: t("Folder chosen") },
            { id: "review", label: t("Review"), description: t("Check the summary") },
            { id: "publish", label: t("Publish"), description: t("Not started") },
          ]}
        />
        <Stepper
          label={t("Vertical steps with an error")}
          orientation="vertical"
          current={1}
          steps={[
            { id: "connect", label: t("Connect"), description: t("Connected") },
            { id: "verify", label: t("Verify"), error: t("Verification failed") },
            { id: "finish", label: t("Finish"), description: t("Waiting") },
            { id: "locked", label: t("Locked step"), disabled: true },
          ]}
        />
        <Stepper
          compact
          label={t("Compact steps")}
          current={1}
          steps={[
            { id: "a", label: t("First") },
            { id: "b", label: t("Second") },
            { id: "c", label: t("Third") },
          ]}
        />
      </MatrixGroup>
      <MatrixGroup
        name={t("Tab label truncation")}
        testId="matrix-nav-tabs-middle"
        className="grid min-w-0 grid-cols-1 gap-3"
      >
        {[180, 120].map((width) => (
          <div
            key={width}
            role="tablist"
            aria-label={`${t("Truncating tabs")} ${width}`}
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
          aria-label={t("End truncating tab")}
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
  const t = useT();
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
    <MatrixSection name={t("Tree rows")} testId="matrix-tree">
      <div
        role="tree"
        aria-label={t("Matrix tree")}
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
  const t = useT();
  const [tabs, setTabs] = useState(INLINE_TABS);
  const [activeTab, setActiveTab] = useState("panel");
  const [activeRow, setActiveRow] = useState("release");
  const [log, setLog] = useState("");
  const close = (id: string) => {
    setTabs((current) => current.filter((tab) => tab.id !== id));
    setLog(`closed ${id}`);
  };
  return (
    <MatrixSection name={t("Inline actions")} testId="matrix-inline">
      <MatrixGroup
        name={t("Tab and close")}
        testId="matrix-inline-tabs"
        className="flex min-w-0 items-center gap-1"
      >
        <div
          role="tablist"
          aria-label={t("Inline tabs")}
          className="flex min-w-0 items-center gap-1"
        >
          {tabs.map((tab) => (
            <ActionHost
              key={tab.id}
              selected={tab.id === activeTab}
              data-testid={`matrix-inline-tab-${tab.id}`}
              className="max-w-56 pe-1"
              // Middle click closes the tab; it never reaches the close action twice. Pressing
              // the middle button must not start browser autoscroll, which swallows the auxclick.
              onMouseDownCapture={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
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
                label={t("Close {p0}", { p0: tab.name })}
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
          {t("Reset tabs")}
        </Button>
      </MatrixGroup>
      <MatrixGroup
        name={t("Rows and actions")}
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
              label={t("More actions for {p0}", { p0: row.name })}
              reveal={row.always ? "always" : "interaction"}
              data-testid={`matrix-inline-more-${row.id}`}
              onClick={() => setLog(`more ${row.id}`)}
            >
              <MoreHorizontal aria-hidden />
            </InlineAction>
            <InlineAction
              label={t("Remove {p0}", { p0: row.name })}
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
        name={t("Tree row and action")}
        testId="matrix-inline-tree"
        className="w-72 max-w-full"
      >
        {/* A row and its action are siblings in the host (no nested interactives); the
            host paints the selected fill. Tree semantics stay with the feature controller. */}
        <div>
          <ActionHost selected data-testid="matrix-inline-tree-row" className="pe-1">
            <TreeRow depth={1} role="button" aria-label={t("selected file.ts")}>
              <TreeRowToggle />
              <TreeRowIcon>
                <File className="size-3.5" aria-hidden />
              </TreeRowIcon>
              <TreeRowLabel>selected file.ts</TreeRowLabel>
            </TreeRow>
            <InlineAction
              label={t("More actions for selected file.ts")}
              onClick={() => setLog("more tree")}
            >
              <MoreHorizontal aria-hidden />
            </InlineAction>
          </ActionHost>
        </div>
      </MatrixGroup>
      <p data-testid="matrix-inline-log" className="text-ui-caption text-(--ui-text-secondary)">
        {log || t("No action yet")}
      </p>
    </MatrixSection>
  );
}

/** F3 contract: caller utilities change placement only; internal presentation stays owned. */
function PlacementMatrix() {
  const t = useT();
  return (
    <MatrixSection name={t("Caller placement")} testId="matrix-placement">
      <MatrixGroup
        name={t("Width and margin utilities")}
        testId="matrix-placement-group"
        className="grid min-w-0 grid-cols-1 gap-2"
      >
        <TextField
          label={t("Placed field")}
          className="w-40 px-10 text-ui-title"
          data-testid="matrix-placement-field"
        />
        <Select
          label={t("Placed select")}
          value="a"
          className="w-40"
          data-testid="matrix-placement-select"
          options={[
            { value: "a", label: t("Alpha") },
            { value: "b", label: t("Beta") },
          ]}
          onValueChange={() => undefined}
        />
        <SegmentedControl
          label={t("Placed segments")}
          value="one"
          className="ms-6"
          options={[
            { value: "one", label: t("One") },
            { value: "two", label: t("Two") },
          ]}
          onValueChange={() => undefined}
        />
        <Button className="w-48" motion="none" data-testid="matrix-placement-button">
          {t("Placed button")}
        </Button>
        {/* ConfirmDialog-style action: a loading contract but no icon reserves no empty slot. */}
        <div className="flex gap-2">
          <Button loading={false} variant="primary" tone="danger" data-testid="matrix-loading-idle">
            {t("Delete")}
          </Button>
          <Button loading variant="primary" tone="danger" data-testid="matrix-loading-busy">
            {t("Delete")}
          </Button>
          <Button
            loading={false}
            startIcon={<Copy aria-hidden />}
            data-testid="matrix-loading-start-icon"
          >
            {t("Copy")}
          </Button>
        </div>
      </MatrixGroup>
    </MatrixSection>
  );
}

function TextMatrix() {
  const t = useT();
  const [now] = useState(() => Date.now());
  const path = "src/shared/ui/SearchableSelect.tsx";
  return (
    <MatrixSection name={t("Text")} testId="matrix-text">
      <MatrixGroup
        name={t("Match text")}
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
      <MatrixGroup name={t("Timestamps")} testId="matrix-text-time">
        <Timestamp value={now} data-testid="matrix-time-today" />
        <Timestamp value={now - 24 * 60 * 60 * 1000} data-testid="matrix-time-yesterday" />
        <Timestamp value={1_800_000_000_000} data-testid="matrix-time-fixed" />
      </MatrixGroup>
      <MatrixGroup name={t("Shortcuts")} testId="matrix-text-shortcut">
        <ShortcutKbd size="xs">K</ShortcutKbd>
        <ShortcutKbd size="sm">Enter</ShortcutKbd>
        <ShortcutKbd size="md">Esc</ShortcutKbd>
        <ShortcutKeys shortcut="Mod+Shift+K" />
        <ShortcutKeys shortcut="Mod+K" size="sm" />
      </MatrixGroup>
      <MatrixGroup
        name={t("Middle truncation")}
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
 * Behaviour and layout matrix of the one control reference (ControlSpecimen, matrix mode). It uses current
 * public APIs with memory-only state, so captures show actual adapter output. `layout` stresses narrow
 * containers and short panes without changing any control. No production route imports it.
 */
export function ControlBehaviorMatrix({
  initialLayout = "default",
}: {
  initialLayout?: ControlMatrixLayout;
}) {
  const t = useT();
  const [layout, setLayout] = useState<ControlMatrixLayout>(initialLayout);
  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-5"
      data-testid="control-matrix"
      data-matrix-layout={layout}
    >
      <SegmentedControl
        label={t("Matrix layout")}
        value={layout}
        options={[
          { value: "default", label: t("Default") },
          { value: "narrow", label: t("Narrow") },
          { value: "short", label: t("Short") },
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
