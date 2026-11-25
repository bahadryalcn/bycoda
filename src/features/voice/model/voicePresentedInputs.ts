import { z } from "zod";
import {
  defineSpec,
  fieldId,
  shortText,
  type PresentedNode,
  type PresentedSpec,
} from "./voicePresentedSpec";

const strict = z.strictObject;
const fieldBase = { id: fieldId, label: shortText(80) };

const localDate = z.iso.date();
/** YYYY-MM-DDTHH:mm with no seconds and no zone: exactly what the picker shows and returns. */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm, without seconds or a zone.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "This is not a real date and time.");

/** A bound period. Whole days include their last day; date-times end at an exclusive instant. */
const dayRange = strict({ start: localDate, end: localDate }).refine(
  (range) => range.end >= range.start,
  "The end day is before the start day.",
);
const instantRange = strict({ start: localDateTime, end: localDateTime }).refine(
  (range) => range.end > range.start,
  "The end must be after the start.",
);

const rangeExample = (type: string, start: string, end: string): PresentedNode => ({
  type,
  id: "period",
  label: "Period",
  value: { start, end },
});

/**
 * Fields whose value is not a plain string, number or boolean, and a choice list. Each is edited in
 * the view and read by a Button through `$bind` as the type its description names.
 */
export const presentedInputSpecs = [
  defineSpec({
    name: "DateTimePicker",
    group: "fields",
    description:
      "One local date and time; the value is YYYY-MM-DDTHH:mm (24-hour), empty when unset.",
    source: "DateTimePicker",
    props: strict({ ...fieldBase, value: localDateTime.optional() }),
    bound: "value",
    example: { type: "DateTimePicker", id: "at", label: "At", value: "2026-11-24T09:30" },
  }),
  defineSpec({
    name: "DateRangePicker",
    group: "fields",
    description:
      'A period of whole days, both included; the value is an object {"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}, or empty when unset.',
    source: "DateRangePicker",
    props: strict({ ...fieldBase, value: dayRange.optional() }),
    bound: "value",
    example: rangeExample("DateRangePicker", "2026-11-01", "2026-11-24"),
  }),
  defineSpec({
    name: "DateTimeRangePicker",
    group: "fields",
    description:
      'A period between two local instants, the end excluded; the value is an object {"start":"YYYY-MM-DDTHH:mm","end":"YYYY-MM-DDTHH:mm"}, or empty when unset.',
    source: "DateTimeRangePicker",
    props: strict({ ...fieldBase, value: instantRange.optional() }),
    bound: "value",
    example: rangeExample("DateTimeRangePicker", "2026-11-24T00:00", "2026-11-25T00:00"),
  }),
  defineSpec({
    name: "Combobox",
    group: "fields",
    description:
      "Free text with suggestions. The owner may type any text or pick a suggestion; the value is a string, kept as typed.",
    source: "Combobox",
    props: strict({
      ...fieldBase,
      value: z.string().max(200).optional(),
      suggestions: z
        .array(strict({ value: shortText(80), label: shortText(80) }))
        .min(1)
        .max(40),
      placeholder: shortText(80).optional(),
      description: shortText(160).optional(),
    }),
    bound: "value",
    example: {
      type: "Combobox",
      id: "branch",
      label: "Branch",
      suggestions: [
        { value: "main", label: "main" },
        { value: "release", label: "release" },
      ],
    },
  }),
  defineSpec({
    name: "RowList",
    group: "choice",
    description:
      "A list of rows to pick one from, each with an optional description and trailing note; nothing is picked until the owner chooses. The value is the picked row's value, or empty.",
    source: "PickerList (ListRow skin)",
    props: strict({
      ...fieldBase,
      value: shortText(80).optional(),
      rows: z
        .array(
          strict({
            value: shortText(80),
            label: shortText(80),
            description: shortText(160).optional(),
            meta: shortText(40).optional(),
          }),
        )
        .min(1)
        .max(40),
    }),
    bound: "value",
    example: {
      type: "RowList",
      id: "session",
      label: "Session",
      rows: [
        { value: "a", label: "Fix login", meta: "2h ago" },
        { value: "b", label: "Review notes", description: "Waiting for you" },
      ],
    },
  }),
  defineSpec({
    name: "FieldGroup",
    group: "layout",
    description:
      "Names several related fields as one question, with optional support text shown under the group. Nest the fields as children.",
    source: "FieldGroup",
    props: strict({
      legend: shortText(80),
      description: shortText(160).optional(),
      layout: z.enum(["stack", "row"]).optional(),
    }),
    children: "nodes",
    example: {
      type: "FieldGroup",
      legend: "Schedule",
      layout: "row",
      children: [
        { type: "DatePicker", id: "day", label: "Day" },
        { type: "TimePicker", id: "at", label: "At" },
      ],
    },
  }),
] satisfies PresentedSpec[];
