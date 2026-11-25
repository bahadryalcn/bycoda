import { z } from "zod";
import { VoicePresentedActionButtonSchema } from "./voicePresentedActions";
import { presentedInputSpecs } from "./voicePresentedInputs";
import { presentedRecordSpecs } from "./voicePresentedRecords";
import { presentedWorkSpecs } from "./voicePresentedWork";
import {
  defineSpec,
  fieldId,
  finite,
  gap,
  labelValue,
  optionList,
  shortText,
  tone,
  type PresentedSpec,
} from "./voicePresentedSpec";

const strict = z.strictObject;
const note = shortText(160).optional();
const fieldBase = { id: fieldId, label: shortText(80) };
const bodyText = shortText(1200);
const chartItems = z
  .array(strict({ label: shortText(40), value: z.number().min(0).max(1e12) }))
  .min(2)
  .max(12);

/** Layout: arbitrary nesting of the content below. */
const layout = [
  defineSpec({
    name: "Stack",
    group: "layout",
    description: "Lays children in a column or a wrapping row. Nest it freely.",
    source: "div (flex)",
    props: strict({
      direction: z.enum(["column", "row"]).optional(),
      gap,
      align: z.enum(["start", "center", "end"]).optional(),
    }),
    children: "nodes",
    example: { type: "Stack", direction: "row", children: [{ type: "Text", text: "Hello" }] },
  }),
  defineSpec({
    name: "Grid",
    group: "layout",
    description: "Responsive columns; each child takes one cell and wraps below the minimum width.",
    source: "div (grid)",
    props: strict({ columns: z.number().int().min(1).max(4).optional(), gap }),
    children: "nodes",
    example: {
      type: "Grid",
      columns: 2,
      children: [
        { type: "Text", text: "One" },
        { type: "Text", text: "Two" },
      ],
    },
  }),
  defineSpec({
    name: "Card",
    group: "layout",
    description: "A framed group with an optional heading.",
    source: "Surface",
    props: strict({ title: shortText(80).optional() }),
    children: "nodes",
    example: { type: "Card", title: "Summary", children: [{ type: "Text", text: "Body" }] },
  }),
  defineSpec({
    name: "Section",
    group: "layout",
    description: "A heading with optional support text above its children.",
    source: "Heading + Text",
    props: strict({ title: shortText(80), description: note }),
    children: "nodes",
    example: { type: "Section", title: "Details", children: [{ type: "Text", text: "Body" }] },
  }),
  defineSpec({
    name: "Disclosure",
    group: "layout",
    description: "Collapsible detail that starts closed unless open is true.",
    source: "Disclosure",
    props: strict({ summary: shortText(80), open: z.boolean().optional() }),
    children: "nodes",
    example: { type: "Disclosure", summary: "More", children: [{ type: "Text", text: "Hidden" }] },
  }),
  defineSpec({
    name: "Divider",
    group: "layout",
    description: "A rule between groups, with an optional centered label.",
    source: "Divider",
    props: strict({ label: shortText(40).optional() }),
    example: { type: "Divider", label: "Or" },
  }),
  defineSpec({
    name: "Tabs",
    group: "layout",
    description:
      "Switch between panels. Children must be Tab nodes; the first Tab opens first. Field values inside every tab stay.",
    source: "Tabs",
    props: strict({}),
    children: "tabs",
    example: {
      type: "Tabs",
      children: [{ type: "Tab", label: "One", children: [{ type: "Text", text: "First" }] }],
    },
  }),
  defineSpec({
    name: "Tab",
    group: "layout",
    description: "One panel of Tabs. Only valid directly inside Tabs.",
    source: "Tabs",
    props: strict({ label: shortText(40) }),
    children: "nodes",
    parent: "Tabs",
    example: {
      type: "Tabs",
      children: [{ type: "Tab", label: "One", children: [{ type: "Text", text: "First" }] }],
    },
  }),
] satisfies PresentedSpec[];

/** Text and take-away content. */
const text = [
  defineSpec({
    name: "Heading",
    group: "text",
    description: "A heading inside the view.",
    source: "Heading",
    props: strict({
      text: shortText(120),
      size: z.enum(["section", "item", "heading"]).optional(),
    }),
    example: { type: "Heading", text: "Results", size: "section" },
  }),
  defineSpec({
    name: "Text",
    group: "text",
    description: "A paragraph, shown as plain text (no HTML or Markdown).",
    source: "Text",
    props: strict({
      text: bodyText,
      tone: z.enum(["primary", "secondary", "muted"]).optional(),
      size: z.enum(["caption", "body"]).optional(),
    }),
    example: { type: "Text", text: "Two packages finished.", tone: "secondary" },
  }),
  defineSpec({
    name: "List",
    group: "text",
    description: "Bulleted or numbered short items.",
    source: "Text (ul/ol)",
    props: strict({
      items: z.array(shortText(240)).min(1).max(12),
      ordered: z.boolean().optional(),
    }),
    example: { type: "List", items: ["First", "Second"] },
  }),
  defineSpec({
    name: "Code",
    group: "text",
    description:
      "Monospace text shown exactly, inline or as a block. Not copied; use CopyBlock to copy.",
    source: "Code / OutputBlock",
    props: strict({ text: z.string().min(1).max(4000), block: z.boolean().optional() }),
    example: { type: "Code", text: "pnpm check:web", block: false },
  }),
  defineSpec({
    name: "CopyBlock",
    group: "text",
    description:
      "Text the owner takes away (a draft, snippet or command), sent exactly as written with a Copy button.",
    source: "OutputBlock + CopyButton",
    props: strict({
      label: shortText(52),
      text: z
        .string()
        .max(4000)
        .refine((value) => value.trim().length > 0),
    }),
    example: { type: "CopyBlock", label: "Command", text: "pnpm build" },
  }),
  defineSpec({
    name: "DiffStat",
    group: "text",
    description: "Added and removed line counts.",
    source: "DiffStat",
    props: strict({
      additions: z.number().int().min(0).max(1e9),
      deletions: z.number().int().min(0).max(1e9),
    }),
    example: { type: "DiffStat", additions: 12, deletions: 3 },
  }),
  defineSpec({
    name: "Timestamp",
    group: "text",
    description:
      "A point in time from an ISO 8601 string, shown as a localized date, clock or age.",
    source: "Timestamp",
    props: strict({
      value: z.iso.datetime({ offset: true }),
      format: z.enum(["auto", "relative", "time", "date"]).optional(),
    }),
    example: { type: "Timestamp", value: "2026-11-24T10:00:00Z", format: "date" },
  }),
] satisfies PresentedSpec[];

/** Status and feedback. */
const feedback = [
  defineSpec({
    name: "Alert",
    group: "feedback",
    description: "A callout for something the owner should notice.",
    source: "Alert",
    props: strict({
      tone: z.enum(["info", "success", "warning", "danger"]).optional(),
      title: shortText(80).optional(),
      text: bodyText,
    }),
    example: { type: "Alert", tone: "warning", title: "Heads up", text: "One check failed." },
  }),
  defineSpec({
    name: "Badge",
    group: "feedback",
    description: "A short label or tag.",
    source: "Badge",
    props: strict({ text: shortText(40), tone: tone.optional() }),
    example: { type: "Badge", text: "New", tone: "accent" },
  }),
  defineSpec({
    name: "BadgeList",
    group: "feedback",
    description: "A wrapping set of short names or tags.",
    source: "BadgeList",
    props: strict({ label: shortText(60), items: z.array(shortText(40)).min(1).max(20) }),
    example: { type: "BadgeList", label: "Packages", items: ["web", "host"] },
  }),
  defineSpec({
    name: "StatusText",
    group: "feedback",
    description: "A status word with its state tone.",
    source: "StatusText",
    props: strict({
      tone: z.enum(["running", "needs-you", "failed", "done", "idle"]),
      text: shortText(60),
    }),
    example: { type: "StatusText", tone: "done", text: "Completed" },
  }),
  defineSpec({
    name: "Progress",
    group: "feedback",
    description: "A bar for known progress; leave value out when the amount is unknown.",
    source: "Progress",
    props: strict({
      value: z.number().min(0).max(1e9).optional(),
      max: z.number().positive().max(1e9).optional(),
      label: shortText(60).optional(),
      tone: tone.optional(),
    }),
    example: { type: "Progress", value: 3, max: 4, label: "Packages" },
  }),
  defineSpec({
    name: "Meter",
    group: "feedback",
    description: "A gauge for a bounded measure such as usage against a limit.",
    source: "Meter",
    props: strict({
      value: finite,
      min: finite.optional(),
      max: finite.optional(),
      label: shortText(60),
      valueText: shortText(40).optional(),
    }),
    example: { type: "Meter", value: 42, max: 100, label: "Quota", valueText: "42%" },
  }),
  defineSpec({
    name: "EmptyState",
    group: "feedback",
    description: "Says that there is nothing to show, and why.",
    source: "EmptyState",
    props: strict({ title: shortText(80), description: note }),
    example: { type: "EmptyState", title: "Nothing found", description: "No runs this week." },
  }),
] satisfies PresentedSpec[];

/** Data: figures, tables and charts drawn from values the model sends. */
const data = [
  defineSpec({
    name: "DescriptionList",
    group: "data",
    description: "Label and value facts about one thing.",
    source: "DescriptionList",
    props: strict({ items: z.array(labelValue).min(1).max(12) }),
    example: { type: "DescriptionList", items: [{ label: "Branch", value: "main" }] },
  }),
  defineSpec({
    name: "StatRow",
    group: "data",
    description: "One to four headline figures side by side.",
    source: "StatRow + StatTile",
    props: strict({ label: shortText(60), items: z.array(labelValue).min(1).max(4) }),
    example: {
      type: "StatRow",
      label: "Tests",
      items: [
        { label: "Passed", value: "42" },
        { label: "Failed", value: "0" },
      ],
    },
  }),
  defineSpec({
    name: "Table",
    group: "data",
    description:
      "Rows and columns of comparable records. Each row is an array of cell text in column order.",
    source: "DataTable",
    props: strict({
      caption: shortText(80),
      columns: z.array(shortText(40)).min(1).max(6),
      rows: z
        .array(z.array(shortText(120)).min(1).max(6))
        .min(1)
        .max(30),
    }),
    example: {
      type: "Table",
      caption: "Packages",
      columns: ["Name", "Status"],
      rows: [["web", "passed"]],
    },
  }),
  defineSpec({
    name: "BarChart",
    group: "data",
    description: "Compare a few amounts. Values are the numbers the model actually observed.",
    source: "BarChart",
    props: strict({ label: shortText(80), unit: shortText(20).optional(), items: chartItems }),
    example: {
      type: "BarChart",
      label: "Tests",
      items: [
        { label: "Web", value: 8 },
        { label: "Host", value: 5 },
      ],
    },
  }),
  defineSpec({
    name: "LineChart",
    group: "data",
    description:
      "One or more measures over ordered points. Each point carries a value for every series key.",
    source: "LineChart",
    props: strict({
      label: shortText(80),
      unit: shortText(20).optional(),
      series: z
        .array(strict({ key: fieldId, label: shortText(40) }))
        .min(1)
        .max(4),
      points: z
        .array(strict({ label: shortText(40), values: z.record(fieldId, finite) }))
        .min(2)
        .max(60),
    }),
    example: {
      type: "LineChart",
      label: "Cost",
      series: [{ key: "cost", label: "Cost" }],
      points: [
        { label: "Mon", values: { cost: 1 } },
        { label: "Tue", values: { cost: 2 } },
      ],
    },
  }),
  defineSpec({
    name: "DonutChart",
    group: "data",
    description: "Shares of one whole.",
    source: "DonutChart",
    props: strict({ label: shortText(80), unit: shortText(20).optional(), items: chartItems }),
    example: {
      type: "DonutChart",
      label: "Share",
      items: [
        { label: "A", value: 3 },
        { label: "B", value: 1 },
      ],
    },
  }),
] satisfies PresentedSpec[];

/** Fields: the owner edits them; their values can be read by a Button through `$bind`. */
const fields = [
  defineSpec({
    name: "TextField",
    group: "fields",
    description: "One line of text. `value` is the starting text; the field's value is a string.",
    source: "TextField",
    props: strict({
      ...fieldBase,
      value: z.string().max(400).optional(),
      placeholder: shortText(80).optional(),
      description: note,
    }),
    bound: "value",
    example: { type: "TextField", id: "query", label: "Search", value: "usage" },
  }),
  defineSpec({
    name: "TextareaField",
    group: "fields",
    description: "Several lines of text; the value is a string.",
    source: "TextareaField",
    props: strict({
      ...fieldBase,
      value: z.string().max(2000).optional(),
      placeholder: shortText(80).optional(),
      description: note,
    }),
    bound: "value",
    example: { type: "TextareaField", id: "notes", label: "Notes" },
  }),
  defineSpec({
    name: "NumberField",
    group: "fields",
    description: "A number with optional min, max and step; the value is a number, or empty.",
    source: "NumberField",
    props: strict({
      ...fieldBase,
      value: finite.optional(),
      min: finite.optional(),
      max: finite.optional(),
      step: finite.optional(),
      description: note,
    }),
    bound: "value",
    example: { type: "NumberField", id: "months", label: "Months", value: 6, min: 1, max: 12 },
  }),
  defineSpec({
    name: "DatePicker",
    group: "fields",
    description: "One local date; the value is YYYY-MM-DD, empty when unset.",
    source: "DatePicker",
    props: strict({ ...fieldBase, value: z.iso.date().optional() }),
    bound: "value",
    example: { type: "DatePicker", id: "day", label: "Day", value: "2026-11-24" },
  }),
  defineSpec({
    name: "TimePicker",
    group: "fields",
    description: "One local time; the value is 24-hour HH:mm, empty when unset.",
    source: "TimePicker",
    props: strict({ ...fieldBase, value: z.iso.time({ precision: -1 }).optional() }),
    bound: "value",
    example: { type: "TimePicker", id: "at", label: "At", value: "09:30" },
  }),
  defineSpec({
    name: "SearchInput",
    group: "fields",
    description: "A search or filter box; the value is a string.",
    source: "SearchInput",
    props: strict({
      ...fieldBase,
      value: z.string().max(200).optional(),
      placeholder: shortText(80).optional(),
    }),
    bound: "value",
    example: { type: "SearchInput", id: "filter", label: "Filter" },
  }),
  defineSpec({
    name: "TagInput",
    group: "fields",
    description: "A list of short values the owner types; the value is an array of strings.",
    source: "TagInput",
    props: strict({
      ...fieldBase,
      value: z.array(shortText(40)).max(20).optional(),
      placeholder: shortText(80).optional(),
    }),
    bound: "value",
    example: { type: "TagInput", id: "labels", label: "Labels", value: ["web"] },
  }),
  defineSpec({
    name: "Slider",
    group: "fields",
    description: "A number inside bounds; the value is a number.",
    source: "Slider",
    props: strict({
      ...fieldBase,
      value: finite.optional(),
      min: finite,
      max: finite,
      step: finite.optional(),
    }),
    bound: "value",
    example: { type: "Slider", id: "level", label: "Level", value: 3, min: 0, max: 10, step: 1 },
  }),
] satisfies PresentedSpec[];

/** Choice: pick from options the model lists. The value is the chosen option's `value`. */
const choice = [
  defineSpec({
    name: "Select",
    group: "choice",
    description: "One choice from a short list in a menu; the value is a string.",
    source: "Select",
    props: strict({ ...fieldBase, value: shortText(80).optional(), options: optionList }),
    bound: "value",
    example: {
      type: "Select",
      id: "period",
      label: "Period",
      value: "month-to-date",
      options: [
        { value: "month-to-date", label: "This month" },
        { value: "last-30-days", label: "Last 30 days" },
      ],
    },
  }),
  defineSpec({
    name: "SegmentedControl",
    group: "choice",
    description: "A few joined options for one exclusive choice; the value is a string.",
    source: "SegmentedControl",
    props: strict({
      ...fieldBase,
      value: shortText(80).optional(),
      options: optionList.max(6),
    }),
    bound: "value",
    example: {
      type: "SegmentedControl",
      id: "metric",
      label: "Metric",
      value: "cost",
      options: [
        { value: "cost", label: "Cost" },
        { value: "tokens", label: "Tokens" },
      ],
    },
  }),
  defineSpec({
    name: "RadioGroup",
    group: "choice",
    description:
      "Visible exclusive options, each with an optional description; the value is a string.",
    source: "RadioGroup",
    props: strict({ ...fieldBase, value: shortText(80).optional(), options: optionList.max(8) }),
    bound: "value",
    example: {
      type: "RadioGroup",
      id: "scope",
      label: "Scope",
      options: [{ value: "all", label: "Everything", description: "All projects" }],
    },
  }),
  defineSpec({
    name: "SearchableSelect",
    group: "choice",
    description: "One choice from a long list with search; the value is a string.",
    source: "SearchableSelect",
    props: strict({ ...fieldBase, value: shortText(80).optional(), options: optionList }),
    bound: "value",
    example: {
      type: "SearchableSelect",
      id: "model",
      label: "Model",
      options: [{ value: "a", label: "Model A" }],
    },
  }),
  defineSpec({
    name: "Checkbox",
    group: "choice",
    description: "A yes or no choice; the value is a boolean (unchecked when unset).",
    source: "Checkbox",
    props: strict({ ...fieldBase, value: z.boolean().optional(), description: note }),
    bound: "value",
    example: { type: "Checkbox", id: "includeFailed", label: "Include failed", value: false },
  }),
  defineSpec({
    name: "Switch",
    group: "choice",
    description: "An on or off setting; the value is a boolean (off when unset).",
    source: "Switch",
    props: strict({ ...fieldBase, value: z.boolean().optional(), description: note }),
    bound: "value",
    example: { type: "Switch", id: "compact", label: "Compact", value: true },
  }),
] satisfies PresentedSpec[];

/** The button's action is a descriptor, never authority; see the catalog's `actions` section. */
const target = VoicePresentedActionButtonSchema.shape;
const orBound = <Text extends z.ZodType>(text: Text) =>
  z.union([text, strict({ $bind: fieldId })]).optional();
export const presentedButtonAction = VoicePresentedActionButtonSchema.omit({ label: true }).extend({
  projectPath: orBound(target.projectPath.unwrap()),
  sessionId: orBound(target.sessionId.unwrap()),
  accountId: orBound(target.accountId.unwrap()),
});

const actions = [
  defineSpec({
    name: "Button",
    group: "actions",
    description:
      'Runs one registered application action. Inside `action.input` and the three target fields, `{"$bind":"fieldId"}` is replaced by that field\'s current value when pressed. `requires` lists field ids that must have a value first.',
    source: "Button",
    props: strict({
      label: shortText(52),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      action: presentedButtonAction,
      requires: z.array(fieldId).max(8).optional(),
    }),
    example: {
      type: "Stack",
      children: [
        {
          type: "Select",
          id: "period",
          label: "Period",
          options: [
            { value: "month-to-date", label: "This month" },
            { value: "last-30-days", label: "Last 30 days" },
          ],
        },
        {
          type: "Button",
          label: "Open Usage",
          variant: "primary",
          requires: ["period"],
          action: { action: "workspace.usage.open", input: { period: { $bind: "period" } } },
        },
      ],
    },
  }),
] satisfies PresentedSpec[];

/**
 * Results the voice turn actually observed. They take no data from the model: each draws what the
 * turn measured, or says nothing was observed.
 */
const observed = [
  defineSpec({
    name: "TestResult",
    group: "observed",
    description: "The latest test run observed in this turn, with its counts.",
    source: "VoiceWorkResults",
    props: strict({}),
    example: { type: "TestResult" },
  }),
  defineSpec({
    name: "CheckResult",
    group: "observed",
    description: "The latest build or check outcome observed in this turn.",
    source: "VoiceWorkResults",
    props: strict({ kind: z.enum(["build", "checks"]) }),
    example: { type: "CheckResult", kind: "build" },
  }),
  defineSpec({
    name: "ChangeResult",
    group: "observed",
    description: "The size of the latest Git change observed in this turn.",
    source: "VoiceWorkResults",
    props: strict({}),
    example: { type: "ChangeResult" },
  }),
  defineSpec({
    name: "FailedCommands",
    group: "observed",
    description: "How many unrecognized commands failed in this turn.",
    source: "VoiceWorkResults",
    props: strict({}),
    example: { type: "FailedCommands" },
  }),
  defineSpec({
    name: "VoiceActions",
    group: "observed",
    description: "The voice tool calls that settled in this turn, newest first.",
    source: "VoiceWorkResults",
    props: strict({}),
    example: { type: "VoiceActions" },
  }),
] satisfies PresentedSpec[];

export const presentedSpecs: readonly PresentedSpec[] = [
  ...layout,
  ...text,
  ...feedback,
  ...data,
  ...fields,
  ...choice,
  ...actions,
  ...observed,
  ...presentedWorkSpecs,
  ...presentedInputSpecs,
  ...presentedRecordSpecs,
];
