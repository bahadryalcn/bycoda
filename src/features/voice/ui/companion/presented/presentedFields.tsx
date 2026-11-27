import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { Combobox } from "../../../../../shared/ui/Combobox";
import { DatePicker } from "../../../../../shared/ui/DatePicker";
import {
  DateTimePicker,
  parseLocalDate,
  parseLocalDateTime,
  toLocalDateTime,
} from "../../../../../shared/ui/DateTimePicker";
import { DateRangePicker } from "../../../../../shared/ui/DateRangePicker";
import { DateTimeRangePicker } from "../../../../../shared/ui/DateTimeRangePicker";
import { PickerList } from "../../../../../shared/ui/picker/PickerList";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { RadioGroup } from "../../../../../shared/ui/RadioGroup";
import { SearchInput } from "../../../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../../../shared/ui/SegmentedControl";
import { Select } from "../../../../../shared/ui/Select";
import { Slider } from "../../../../../shared/ui/Slider";
import { Switch } from "../../../../../shared/ui/Switch";
import { TagInput } from "../../../../../shared/ui/TagInput";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { TimePicker } from "../../../../../shared/ui/TimePicker";
import { presentedView, type PresentedView, type PresentedViewContext } from "./presentedContext";

type Option = { value: string; label: string; description?: string; meta?: string };
type Period = { start: string; end: string };
type Base = { label: string; description?: string; placeholder?: string };

/** The field's current value and a setter, typed for one kind of value. */
const text = (field: PresentedViewContext["field"]) => ({
  value: typeof field?.value === "string" ? field.value : "",
  set: (value: string) => field?.setValue(value),
});

/** A bound period as the picker's dates, or null while unset or if a stored end is not a date. */
const period = (field: PresentedViewContext["field"], parse: (value: string) => Date | null) => {
  const value = field?.value as Partial<Period> | null | undefined;
  const start = typeof value?.start === "string" ? parse(value.start) : null;
  const end = typeof value?.end === "string" ? parse(value.end) : null;
  return start && end ? { start, end } : null;
};

/**
 * Fields and choices. Each reads and writes its value through the OpenUI `$field` variable the
 * program binds, so the view keeps what the owner typed and a Button can read it with `$bind`.
 */
export const presentedFieldViews: Record<string, PresentedView> = {
  TextField: presentedView<Base>(({ label, description, placeholder, field }) => (
    <TextField
      label={label}
      description={description}
      placeholder={placeholder}
      value={text(field).value}
      onChange={(event) => text(field).set(event.target.value)}
    />
  )),
  TextareaField: presentedView<Base>(({ label, description, placeholder, field }) => (
    <TextareaField
      label={label}
      description={description}
      placeholder={placeholder}
      value={text(field).value}
      onChange={(event) => text(field).set(event.target.value)}
    />
  )),
  NumberField: presentedView<Base & { value?: number; min?: number; max?: number; step?: number }>(
    ({ label, description, min, max, step, value, field }) => (
      <NumberField
        label={label}
        description={description}
        min={min}
        max={max}
        step={step}
        // The input owns the draft, so typing "1." or "-" is never rewritten; only valid numbers are kept.
        defaultValue={typeof field?.value === "number" ? field.value : value}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          field?.setValue(Number.isFinite(next) ? next : null);
        }}
      />
    ),
  ),
  DatePicker: presentedView<Base>(({ label, field }) => (
    <DatePicker label={label} value={text(field).value} onChange={text(field).set} clearable />
  )),
  TimePicker: presentedView<Base>(({ label, field }) => (
    <TimePicker label={label} value={text(field).value} onChange={text(field).set} clearable />
  )),
  DateTimePicker: presentedView<Base>(({ label, field }) => (
    <DateTimePicker label={label} value={text(field).value} onChange={text(field).set} clearable />
  )),
  DateRangePicker: presentedView<Base>(({ label, field }) => (
    <DateRangePicker
      label={label}
      value={period(field, parseLocalDate)}
      // The picker reports local days; the field keeps them as YYYY-MM-DD text, never as Date objects.
      onChange={(range) =>
        field?.setValue({
          start: toLocalDateTime(range.start).slice(0, 10),
          end: toLocalDateTime(range.end).slice(0, 10),
        })
      }
      onClear={() => field?.setValue(null)}
    />
  )),
  DateTimeRangePicker: presentedView<Base>(({ label, field }) => (
    <DateTimeRangePicker
      label={label}
      value={period(field, parseLocalDateTime)}
      onChange={(range) =>
        field?.setValue({ start: toLocalDateTime(range.start), end: toLocalDateTime(range.end) })
      }
      onClear={() => field?.setValue(null)}
    />
  )),
  Combobox: presentedView<Base & { suggestions: { value: string; label: string }[] }>(
    ({ label, description, placeholder, suggestions, field }) => (
      <Combobox
        label={label}
        description={description}
        placeholder={placeholder}
        options={suggestions}
        allowCustomValue
        value={text(field).value}
        onValueChange={text(field).set}
      />
    ),
  ),
  SearchInput: presentedView<Base>(({ label, placeholder, field }) => (
    <SearchInput
      aria-label={label}
      placeholder={placeholder ?? label}
      value={text(field).value}
      onChange={(event) => text(field).set(event.target.value)}
    />
  )),
  TagInput: presentedView<Base>(({ label, placeholder, field }) => (
    <TagInput
      label={label}
      placeholder={placeholder}
      value={Array.isArray(field?.value) ? (field.value as string[]) : []}
      onValueChange={(value) => field?.setValue(value)}
    />
  )),
  Slider: presentedView<Base & { min: number; max: number; step?: number }>(
    ({ label, min, max, step, field }) => (
      <Slider
        label={label}
        min={min}
        max={max}
        step={step}
        showValue
        value={typeof field?.value === "number" ? field.value : min}
        onValueChange={(value) => field?.setValue(value)}
      />
    ),
  ),

  Select: presentedView<Base & { options: Option[] }>(({ label, options, field }) => (
    <Select
      label={label}
      options={options}
      value={text(field).value}
      onValueChange={text(field).set}
    />
  )),
  SegmentedControl: presentedView<Base & { options: Option[] }>(({ label, options, field }) => (
    <div className="grid min-w-0 gap-1.5">
      <Text as="span" size="caption" tone="muted">
        {label}
      </Text>
      <SegmentedControl
        label={label}
        options={options}
        value={text(field).value}
        onValueChange={text(field).set}
      />
    </div>
  )),
  RadioGroup: presentedView<Base & { options: Option[] }>(({ label, options, field }) => (
    <RadioGroup
      label={label}
      options={options}
      value={text(field).value}
      onValueChange={text(field).set}
    />
  )),
  SearchableSelect: presentedView<Base & { options: Option[] }>(
    ({ label, options, placeholder, field }) => (
      <SearchableSelect
        label={label}
        options={options}
        placeholder={placeholder ?? label}
        value={text(field).value}
        onChange={text(field).set}
      />
    ),
  ),
  RowList: presentedView<Base & { rows: Option[] }>(({ label, rows, field }) => (
    <div className="grid min-w-0 gap-1.5">
      <Text as="span" size="caption" tone="muted">
        {label}
      </Text>
      <PickerList
        label={label}
        options={rows.map((row) => ({
          value: row.value,
          title: row.label,
          description: row.description,
          meta: row.meta,
        }))}
        value={text(field).value || null}
        onChange={text(field).set}
        checkPlacement="none"
        selectionIndicator="start"
      />
    </div>
  )),
  Checkbox: presentedView<Base>(({ label, description, field }) => (
    <Checkbox
      label={label}
      description={description}
      checked={field?.value === true}
      onChange={(event) => field?.setValue(event.target.checked)}
    />
  )),
  Switch: presentedView<Base>(({ label, description, field }) => (
    <Switch
      label={label}
      description={description}
      checked={field?.value === true}
      onCheckedChange={(checked) => field?.setValue(checked)}
    />
  )),
};
